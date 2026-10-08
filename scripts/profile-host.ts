import { randomUUID } from "node:crypto";
import { processIdentity } from "../packages/browser/process-identity";
import "dotenv/config";
import { recoveryCookies, checkpointCookies, sessionAfterCheckFailure } from "../packages/browser/session-cookies";
import { publishXPost, prepareXAccount, XSessionError } from "../packages/browser/x-post";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Worker } from "bullmq";
import { db } from "../packages/database";
import { connection, profileQueue } from "../packages/shared/queue";
import { proxyOptions } from "../packages/browser/runtime";
import { encrypt, decrypt } from "../packages/shared/security";
import { isXSessionReady } from "../packages/browser/adapters";
import { parseXCookies, exportXCookies } from "../packages/browser/x-cookies";
import { inspectIp } from "../packages/browser/profiles";
import {
  PersistentProfiles,
  ProfileError,
  assertBrowserId,
  browserIds,
  getProfilePath,
  resetConfirmation,
  type BrowserId,
  type ProfileConnection,
} from "../packages/browser/persistent-profiles";
import {
  fixtureOrigin,
  startPersistenceFixture,
  readFixture,
  writeFixture,
} from "../packages/browser/persistence-fixture";
const virtualDisplay = process.env.BROWSER_DISPLAY === "virtual";
const browserMode = virtualDisplay ? "VIRTUAL" : "HEADLESS";
const headlessBrowser = !virtualDisplay;
const redis = connection();
// One host owner, in addition to per-directory locks and Chrome's native profile lock.
const hostToken = randomUUID();
if (!(await redis.set("browser-host-owner", hostToken, "EX", 15, "NX")))
  throw new Error("A browser host is already online");
let stopping = false;
const heartbeat = setInterval(() => {
  if (!stopping)
    void redis
      .eval(
        "if redis.call('get',KEYS[1]) == ARGV[1] then redis.call('expire',KEYS[1],15); if redis.call('get',KEYS[2]) == ARGV[1] then redis.call('expire',KEYS[2],15) end; return 1 else return 0 end",
        2,
        "browser-host-owner",
        "browser-host-ready",
        hostToken,
      )
      .then((result) => {
        if (!result) void shutdown();
      })
      .catch(() => {
        void shutdown();
      });
}, 3000);
const profiles = new PersistentProfiles(
  resolve("data/browser-profiles"),
  (event) => console.log(JSON.stringify(event)),
  async (id) => {
    await db.browserProfile.update({
      where: { id },
      data: { status: "STOPPED", chromePid: null },
    });
  },
);
await mkdir("data", { recursive: true, mode: 0o700 });
await writeFile("data/browser-host.pid", String(process.pid), { mode: 0o600 });
await writeFile("data/browser-host-owner.json", JSON.stringify({pid:process.pid, token:hostToken, identity:await processIdentity(process.pid)}), {mode:0o600});
const fixture = await startPersistenceFixture();
for (const id of browserIds) {
  const path = await profiles.create(id);
  await db.browserProfile.upsert({
    where: { id },
    update: {
      profilePath: path,
      profileExists: true,
      status: "STOPPED",
      chromePid: null,
      mode: browserMode,
    },
    create: {
      id,
      name: id.replace("browser-", "Browser "),
      profilePath: path,
      profileExists: true,
      connectionMode: "DIRECT",
      mode: browserMode,
    },
  });
}
async function getConnection(id: BrowserId): Promise<ProfileConnection> {
  const profile = await db.browserProfile.findUniqueOrThrow({
    where: { id },
    include: { proxy: true },
  });
  if (profile.connectionMode === "DIRECT")
    return { mode: "DIRECT", proxyId: profile.proxyId, headless: headlessBrowser };
  if (!profile.proxy?.enabled)
    throw new ProfileError("Assign an enabled proxy before selecting PROXY");
  return {
    mode: "PROXY",
    headless: headlessBrowser,
    proxyId: profile.proxyId,
    proxy: proxyOptions(profile.proxy, false),
  };
}
async function open(id: BrowserId) {
  const entry = await profiles.open(id, await getConnection(id));
  const stored = await db.browserProfile.findUniqueOrThrow({ where: { id } });
  if (stored.cookiesImportedAt && stored.encryptedSession) {
    const saved = JSON.parse(decrypt(stored.encryptedSession));
    const current = await exportXCookies(entry.context);
    const recovery = recoveryCookies(current, saved.cookies, stored.sessionStatus);
    if (recovery.length) await entry.context.addCookies(recovery);
  }
  await db.browserProfile.update({
    where: { id },
    data: {
      status: "RUNNING",
      chromePid: entry.pid,
      lastOpenedAt: entry.startedAt,
      profilePath: entry.profilePath,
      profileExists: true,
      mode: browserMode,
      lastError: null,
    },
  });
  // IP inspection is informational. It never closes the user's browser or blocks manual browsing.
  try {
    const ip = await inspectIp(entry.context).catch(() => inspectIp(entry.context, "https://api.ipify.org?format=json"));
    await db.browserProfile.update({
      where: { id },
      data: { publicIp: ip, ipCheckedAt: new Date() },
    });
  } catch {
    await db.browserProfile.update({
      where: { id },
      data: {
        publicIp: null,
        ipCheckedAt: null,
        lastError:
          "Public IP check failed. Browser remains open; profile data was preserved.",
      },
    });
  }
  return entry;
}
async function saveImportedCookies(id: BrowserId) {
  const entry = profiles.live.get(id);
  const row = await db.browserProfile.findUniqueOrThrow({ where: { id } });
  if (!entry || !row.cookiesImportedAt) return;
  const cookies = checkpointCookies(await exportXCookies(entry.context));
  if (!cookies) return;
  await db.browserProfile.updateMany({
    where: { id, cookiesImportedAt: row.cookiesImportedAt, encryptedSession: row.encryptedSession },
    data: {
      encryptedSession: encrypt(JSON.stringify({ cookies })),
      cookieCount: cookies.length,
    },
  });
}
async function checkLogin(id: string) {
  assertBrowserId(id);
        if (!profiles.live.has(id)) await open(id);
        const previous = await db.browserProfile.findUniqueOrThrow({where:{id}});
        try {
          const entry = profiles.live.get(id)!;
          const publicIp = await inspectIp(entry.context).catch(() => null);
          if (publicIp) await db.browserProfile.update({where:{id},data:{publicIp,ipCheckedAt:new Date()}});
          const page = await profiles.navigate(id, "https://x.com/home");
          await prepareXAccount(page);
          const accepted = await isXSessionReady(page);
          const identity = accepted
            ? await page
                .locator('[data-testid="SideNav_AccountSwitcher_Button"]')
                .innerText()
            : "";
          const username = identity.match(/@[a-zA-Z0-9_]{1,15}\b/)?.[0] || null;
          await saveImportedCookies(id);
          await db.browserProfile.update({
            where: { id },
            data: {
              sessionStatus: accepted ? "VERIFIED" : "REJECTED",
              sessionUsername: username,
              sessionCheckedAt: new Date(),
              lastError: accepted
                ? null
                : "X did not show an authenticated account. Imported cookies may be expired, revoked or require verification.",
            },
          });
        } catch (error) {
          await db.browserProfile.update({
            where: { id },
            data: {
              sessionStatus: sessionAfterCheckFailure(previous.sessionStatus, previous.sessionUsername, error instanceof XSessionError && error.sessionStatus === "REJECTED"),
              lastError: error instanceof XSessionError ? error.message : "Connection check failed. Saved cookies are preserved. Check the proxy connection and use Recheck connection.",
              sessionCheckedAt: new Date(),
              ...(error instanceof XSessionError && error.sessionStatus === "REJECTED" ? {sessionUsername: null} : {}),
            },
          });
          const page = profiles.live.get(id)?.context.pages()[0];
          if (page) {
            await page.screenshot({path:`data/${id}-connection-check.png`,timeout:5000}).catch(()=>{});
            console.log(JSON.stringify({id,event:"session-check-failed",hasLiveAuth:!!checkpointCookies(await exportXCookies(page.context())),rejected:error instanceof XSessionError && error.sessionStatus === "REJECTED",path:new URL(page.url()).pathname}));
          }
          throw error;
        }

}

const activeOperations = new Set<string>();
const worker = new Worker(
  "browser-profiles",
  async (job) => {
    const {
      id: rawId,
      action,
      connectionMode,
      confirmation,
      encryptedCookies,
      text,
      expectedUsername,
    } = job.data as {
      id: string;
      action: string;
      connectionMode?: string;
      confirmation?: string;
      encryptedCookies?: string;
      text?: string;
      expectedUsername?: string;
    };
    assertBrowserId(rawId);
    const id = rawId;
    activeOperations.add(id);
    try {
      if (action === "CREATE") {
        const path = await profiles.create(id);
        await db.browserProfile.update({
          where: { id },
          data: { profilePath: path, profileExists: true, lastError: null },
        });
      } else if (action === "CLOSE") {
        await saveImportedCookies(id);
        await profiles.close(id);
        await db.browserProfile.update({
          where: { id },
          data: { status: "STOPPED", chromePid: null },
        });
      } else if (action === "CONNECTION") {
        if (connectionMode !== "DIRECT" && connectionMode !== "PROXY")
          throw new ProfileError("Choose DIRECT or PROXY");
        if (profiles.live.has(id))
          throw new ProfileError(
            "Close the browser before changing its connection mode",
          );
        const profile = await db.browserProfile.findUniqueOrThrow({
          where: { id },
          include: { proxy: true },
        });
        if (connectionMode === "PROXY" && !profile.proxy?.enabled)
          throw new ProfileError(
            "Assign an enabled proxy before selecting PROXY",
          );
        await db.browserProfile.update({
          where: { id },
          data: {
            connectionMode,
            publicIp: null,
            ipCheckedAt: null,
            lastError: null,
          },
        });
      } else if (action === "RESET") {
        if (confirmation !== resetConfirmation)
          throw new ProfileError("Explicit reset confirmation is required");
        await profiles.reset(id, confirmation);
        await db.browserProfile.update({
          where: { id },
          data: {
            profileExists: true,
            lastError: null,
            lastLoginAt: null,
            lastInstagramLoginAt: null,
            encryptedSession: null,
            cookiesImportedAt: null,
            cookieCount: 0,
            sessionStatus: "NONE",
            sessionCheckedAt: null,
            sessionUsername: null,
            status: "STOPPED",
            chromePid: null,
          },
        });
      } else if (action === "IMPORT_COOKIES" || action === "CONNECT_X") {
        if (!encryptedCookies)
          throw new ProfileError("No cookie export supplied");
        const cookies = parseXCookies(decrypt(encryptedCookies));
        if (!profiles.live.has(id)) await open(id);
        const context = profiles.live.get(id)!.context;
        const previous = await exportXCookies(context);
        try {
          await context.clearCookies({
            domain: /(^|\.)(x\.com|twitter\.com)$/,
          });
          await context.addCookies(cookies);
        } catch {
          await context.addCookies(previous);
          throw new ProfileError(
            "Cookie import failed. Previous cookies were restored",
          );
        }
        await db.browserProfile.update({
          where: { id },
          data: {
            encryptedSession: encrypt(JSON.stringify({ cookies })),
            cookiesImportedAt: new Date(),
            cookieCount: cookies.length,
            sessionStatus: "SAVED",
            sessionCheckedAt: null,
            sessionUsername: null,
            lastError: null,
          },
        });
        if (action === "CONNECT_X") await checkLogin(id);
      } else if (action === "CHECK_IP") {
        if (!profiles.live.has(id)) await open(id);
        const publicIp = await inspectIp(profiles.live.get(id)!.context).catch(() => inspectIp(profiles.live.get(id)!.context, "https://api.ipify.org?format=json"));
        const row = await db.browserProfile.findUniqueOrThrow({where:{id},include:{proxy:true}});
        await db.browserProfile.update({where:{id},data:{publicIp,ipCheckedAt:new Date(), ...(row.lastError?.startsWith("Public IP check failed.") ? {lastError:null} : {})}});
        console.log(JSON.stringify({id,event:"proxy-verified",publicIp,proxyHost:row.proxy?.host,proxyPort:row.proxy?.port}));
      } else if (action === "CHECK_LOGIN") {
        await checkLogin(id);
      } else if (action === "POST_TEXT") {
        let submitted = false;
        let postStage = "account preparation";
        let postPage: import("playwright").Page | undefined;
        try {
          const row = await db.browserProfile.findUniqueOrThrow({ where: { id } });
          if (row.postAttemptId === job.id) {
            if (row.postStatus === "POSTING") await db.browserProfile.update({ where: { id }, data: { postStatus: "UNKNOWN", postError: "Posting was interrupted. Check your X profile before trying again to avoid a duplicate." } });
            return;
          }
          if (!text || !expectedUsername || row.sessionUsername !== expectedUsername || row.sessionStatus !== "VERIFIED")
            throw new ProfileError("Connect the expected account before posting");
          if (!profiles.live.has(id)) await open(id);
          await db.browserProfile.update({ where: { id }, data: { postAttemptId: job.id } });
          postStage = "open X home";
          const page = await profiles.navigate(id, "https://x.com/home");
          postPage = page;
          const url = await publishXPost(page, text, expectedUsername, () => { submitted = true; }, stage => { postStage = stage; });
          await saveImportedCookies(id);
          await db.browserProfile.update({ where: { id }, data: { postStatus: "POSTED", postUrl: url, postError: null } });
        } catch (error) {
          const reason = error instanceof ProfileError || error instanceof XSessionError
            ? error.message
            : `Could not complete ${postStage}.`;
          const message = submitted
            ? "The Post button was attempted, but X did not confirm publication. Check your X profile before trying again to avoid a duplicate."
            : `Post was not submitted: ${reason}`;
          const previous = await db.browserProfile.findUniqueOrThrow({where:{id}});
          await db.browserProfile.update({ where: { id }, data: {
            postStatus: submitted ? "UNKNOWN" : "FAILED", postError: message,
            ...(!submitted && error instanceof XSessionError ? { sessionStatus: sessionAfterCheckFailure(previous.sessionStatus, previous.sessionUsername, error.sessionStatus === "REJECTED"), sessionCheckedAt: new Date(), lastError: error.message } : {}),
          } });
          const diagnostic = error instanceof Error ? error.message.split("\n")[0].slice(0,200) : "Unknown error";
          console.log(JSON.stringify({ id, event: "post-failed", submitted, reason, stage: postStage, diagnostic }));
          if (postPage) {
            await postPage.screenshot({path: `data/${id}-post-failure.png`, timeout:5000}).catch(()=>{});
            console.log(JSON.stringify({ id, event: "composer-diagnostic", dialogs:await postPage.getByRole("dialog").count(), editors:await postPage.locator('[data-testid="tweetTextarea_0"]').count(), visibleComposer:await postPage.locator('[data-testid="tweetTextarea_0"]').first().isVisible() }));
          }
        }
      } else if (action === "OPEN") {
        await open(id);
      } else if (action === "OPEN_X") {
        if (!profiles.live.has(id)) await open(id);
        const url = "https://x.com/";
        await profiles.navigate(id, url);
      } else if (action === "TEST_PERSISTENCE") {
        const connection = await getConnection(id);
        if (connection.mode !== "DIRECT")
          throw new ProfileError(
            "Select DIRECT for the local persistence test",
          );
        if (!profiles.live.has(id)) await open(id);
        const page = await profiles.navigate(
          id,
          `${fixtureOrigin}/persistence/${id}`,
        );
        await writeFixture(page, id);
        const oldPid = profiles.live.get(id)!.pid;
        await profiles.close(id);
        await open(id);
        const reopened = await profiles.navigate(
          id,
          `${fixtureOrigin}/persistence/${id}`,
        );
        const state = await readFixture(reopened);
        if (
          state.cookie !== id ||
          state.localStorage !== id ||
          state.indexedDB !== id
        )
          throw new ProfileError(
            "Persistence test failed. Profile preserved for inspection.",
          );
        await db.browserProfile.update({
          where: { id },
          data: {
            persistenceResult:
              "PASS: cookie, localStorage and IndexedDB survived close/reopen; previous Chrome process exited.",
            persistenceCheckedAt: new Date(),
            lastError: null,
          },
        });
        console.log(
          JSON.stringify({
            id,
            event: "persistence-passed",
            profilePath: getProfilePath(id),
            previousPid: oldPid,
            pid: profiles.live.get(id)!.pid,
          }),
        );
      } else throw new ProfileError("Unknown browser action");
    } catch (error) {
      const message =
        error instanceof ProfileError || error instanceof XSessionError
          ? error.message
          : "Browser operation failed. Profile data was preserved. Check configuration and service health.";
      await db.browserProfile.update({
        where: { id },
        data: {
          status: profiles.live.has(id) ? "RUNNING" : "STOPPED",
          lastError: message,
        },
      });
      if (action === "TEST_PERSISTENCE")
        await db.browserProfile.update({
          where: { id },
          data: {
            persistenceResult: `FAILED: ${message}`,
            persistenceCheckedAt: new Date(),
          },
        });
      console.log(
        JSON.stringify({
          id,
          event: "operation-failed",
          action,
          error: message,
          profilePath: getProfilePath(id),
        }),
      );
    } finally {
      activeOperations.delete(id);
      await redis.del(`profile-operation:${id}`);
    }
  },
  { connection: connection(), concurrency: 1 },
);
worker.on("error", () => console.error("Browser host queue connection error"));
worker.on("failed", async (job) => {
  if (job) await redis.del(`profile-operation:${job.data.id}`);
});
await worker.waitUntilReady();
await redis.set("browser-host-ready", hostToken, "EX", 15);
let checkpointRunning = false;
const sessionCheckpoint = setInterval(async () => {
  if (stopping || checkpointRunning) return;
  checkpointRunning = true;
  try {
    for (const id of profiles.live.keys()) {
      if (activeOperations.has(id)) continue;
      await saveImportedCookies(id).catch(() => {});
    }
  } finally { checkpointRunning = false; }
}, 60000);
sessionCheckpoint.unref();

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  clearInterval(sessionCheckpoint);
  console.log("Browser host shutdown: draining queue");
  await worker.close();
  console.log("Browser host shutdown: saving and closing profiles");
  for (const id of [...profiles.live.keys()]) {
    await saveImportedCookies(id).catch(() => {});
    await profiles.close(id).catch(() => {});
  }
  console.log("Browser host shutdown: closing services");
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  await redis.eval(
    "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
    1,
    "browser-host-ready",
    hostToken,
  );
  await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, "browser-host-owner", hostToken);
  await profileQueue().close();
  await redis.quit();
  await db.$disconnect();
  if (virtualDisplay && /^\d+$/.test(process.env.BROWSER_DISPLAY_PID || "")) {
    try { process.kill(Number(process.env.BROWSER_DISPLAY_PID), "SIGTERM"); } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  process.exit(0);
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    void shutdown();
  });
console.log(
  "Browser host ready: five persistent background X profiles. Cookie import and explicit session checks only.",
);
