import { inspectIp } from "../../packages/browser/profiles";
import "dotenv/config";
import { Worker } from "bullmq";
import pino from "pino";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { db } from "../../packages/database";
import { connection } from "../../packages/shared/queue";
import { config } from "../../packages/shared/config";
import { encrypt, decrypt } from "../../packages/shared/security";
import { adapter, ManualAction } from "../../packages/browser/adapters";
import {
  launch,
  loadSession,
  saveSession,
  sessionFile,
} from "../../packages/browser/runtime";
const c = config();
const logger = pino({
  redact: ["password", "username", "cookie", "authorization"],
});
const redis = connection();
const worker = new Worker(
  "browser-jobs",
  async (job) => {
    const record = await db.postJob.findUniqueOrThrow({
      where: { id: job.data.id },
      include: {
        account: {
          include: {
            website: true,
            proxy: true,
            browserProfile: { include: { proxy: true } },
          },
        },
      },
    });
    const a = record.account;
    const lock = `account-lock:${a.id}`;
    if (
      !(await redis.set(lock, record.id, "PX", c.JOB_TIMEOUT_MS + 60000, "NX"))
    )
      throw new Error("Account already has an active operation");
    const started = Date.now();
    let browser: Awaited<ReturnType<typeof launch>> | undefined;
    let page: import("playwright").Page | undefined;
    let timedOut = false;
    const logs: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let submitted = false;
    try {
      await db.postJob.update({
        where: { id: record.id },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      logs.push("Launching Chromium");
      const profile = a.browserProfile;
      if (profile?.profilePath)
        throw new ManualAction(
          "Persistent manual browser profiles are isolated from posting automation. Use the Browsers page for manual browsing.",
        );
      if (profile?.proxyId && !profile.proxy?.enabled)
        throw new ManualAction("The browser profile proxy is disabled.");
      browser = await launch(profile ? profile.proxy : a.proxy, !profile);
      const context = await browser.newContext({
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
        storageState: profile
          ? profile.encryptedSession
            ? JSON.parse(decrypt(profile.encryptedSession))
            : undefined
          : await loadSession(a.id),
      });
      if (profile && profile.publicIp !== (await inspectIp(context)))
        throw new ManualAction(
          "Profile IP changed. Check your fixed proxy endpoint before reusing this session.",
        );
      context.setDefaultTimeout(c.NAVIGATION_TIMEOUT_MS);
      context.setDefaultNavigationTimeout(c.NAVIGATION_TIMEOUT_MS);
      page = await context.newPage();
      page.on("pageerror", () => logs.push("Browser page script error"));
      timer = setTimeout(() => {
        timedOut = true;
        void browser?.close();
      }, c.JOB_TIMEOUT_MS);
      logs.push("Browser context initialized; checking authentication");
      const site = adapter(
        a.website.adapterType,
        a.website.baseUrl,
        a.username,
      );
      if (!(await site.isAuthenticated(page))) {
        const pw =
          a.website.adapterType === "mock"
            ? "test-password"
            : a.encryptedPassword
              ? decrypt(a.encryptedPassword)
              : process.env.ACCOUNT_PASSWORD;
        if (!pw)
          throw new ManualAction(
            "No password configured. Set ACCOUNT_PASSWORD in .env or use npm run login.",
          );
        logs.push("Starting configured login workflow");
        await site.login(
          page,
          a.website.adapterType === "x-development"
            ? process.env.ACCOUNT_LOGIN_IDENTIFIER || a.username
            : a.username,
          pw,
        );
        await db.account.update({
          where: { id: a.id },
          data: { lastLoginAt: new Date() },
        });
      }
      logs.push("Authentication verified; saving encrypted session");
      if (profile)
        await db.browserProfile.update({
          where: { id: profile.id },
          data: {
            encryptedSession: encrypt(
              JSON.stringify(await context.storageState({ indexedDB: true })),
            ),
          },
        });
      else await saveSession(a.id, await context.storageState());
      let publishedUrl: string | undefined;
      if (record.kind === "POST") {
        logs.push("Opening composer");
        await site.navigateToComposer(page);
        await site.enterPost(page, record.content);
        logs.push("Submitting post; automatic retries disabled");
        submitted = true;
        await site.publishPost(page);
        logs.push("Verifying publication");
        publishedUrl = await site.verifyPostPublished(page, record.content);
        if (profile)
          await db.browserProfile.update({
            where: { id: profile.id },
            data: {
              encryptedSession: encrypt(
                JSON.stringify(await context.storageState({ indexedDB: true })),
              ),
            },
          });
        else await saveSession(a.id, await context.storageState());
      }
      await db.postJob.update({
        where: { id: record.id },
        data: {
          status: "SUCCESS",
          completedAt: new Date(),
          durationMs: Date.now() - started,
          publishedUrl,
          logs,
        },
      });
      await db.account.update({
        where: { id: a.id },
        data: {
          sessionPath: profile ? `profile:${profile.id}` : sessionFile(a.id),
          status: "READY",
          lastJobAt: new Date(),
          lastError: null,
        },
      });
      logger.info({ jobId: record.id }, "Job successful");
    } catch (e) {
      const manual = e instanceof ManualAction;
      const message = manual
        ? (e as Error).message
        : timedOut
          ? "Job timed out"
          : submitted
            ? "Posting result uncertain. Inspect the website before retrying."
            : "Browser operation failed. Inspect the screenshot and connection.";
      let screenshot: string | undefined;
      try {
        await mkdir(join(c.dataDir, "screenshots"), {
          recursive: true,
          mode: 0o700,
        });
        await chmod(join(c.dataDir, "screenshots"), 0o700);
        if (!page) throw new Error("No browser page available");
        screenshot = `${record.id}.png`;
        await page.screenshot({
          path: join(c.dataDir, "screenshots", screenshot),
          fullPage: true,
        });
      } catch {
        screenshot = undefined;
      }
      await db.postJob.update({
        where: { id: record.id },
        data: {
          status: manual ? "REQUIRES_MANUAL_ACTION" : "FAILED",
          error: message,
          completedAt: new Date(),
          durationMs: Date.now() - started,
          lastUrl: page?.url().split("?")[0],
          screenshot,
          logs,
        },
      });
      await db.account.update({
        where: { id: a.id },
        data: {
          status: manual ? "REQUIRES_MANUAL_ACTION" : "ERROR",
          lastError: message,
          lastJobAt: new Date(),
        },
      });
      logger.warn({ jobId: record.id }, message);
    } finally {
      if (timer) clearTimeout(timer);
      await browser?.close();
      await redis.eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        lock,
        record.id,
      );
    }
  },
  { connection: connection(), concurrency: 1 },
);
worker.on("failed", async (job) => {
  if (job)
    await db.postJob.updateMany({
      where: { id: job.data.id, status: "QUEUED" },
      data: {
        status: "FAILED",
        error: "Worker could not acquire account or initialize job",
        completedAt: new Date(),
      },
    });
});
worker.on("error", () => logger.error("Queue connection error"));
const health = createServer(async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    await redis.ping();
    res.end(JSON.stringify({ ok: true }));
  } catch {
    res.statusCode = 503;
    res.end('{"ok":false}');
  }
}).listen(3001, "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    health.close();
    await worker.close();
    await redis.quit();
    await db.$disconnect();
    process.exit(0);
  });
logger.info("Browser worker ready");
