import { validatePostText } from "../../../../../packages/browser/x-post";
import { parseXCookies } from "../../../../../packages/browser/x-cookies";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../../../../../packages/database";
import { config } from "../../../../../packages/shared/config";
import {
  token,
  validToken,
  encrypt,
} from "../../../../../packages/shared/security";
import {
  profileQueue,
  postingQueue,
} from "../../../../../packages/shared/queue";
import { launch, sessionFile } from "../../../../../packages/browser/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const attempts = new Map<string, { count: number; time: number }>();
async function handle(req: NextRequest) {
  const p = req.nextUrl.pathname.replace("/api/", "");
  try {
    if (
      req.method !== "GET" &&
      req.headers.get("origin") !== req.nextUrl.origin
    )
      return NextResponse.json(
        { error: "Invalid request origin" },
        { status: 403 },
      );
    if (p === "auth" && req.method === "POST") {
      // The dashboard is localhost-only. Do not trust spoofable forwarding headers.
      const key = "local";
      const entry = attempts.get(key);
      if (entry && entry.time > Date.now() && entry.count >= 10)
        return NextResponse.json(
          { error: "Too many attempts. Try again in 15 minutes." },
          { status: 429 },
        );
      const body = z
        .object({ password: z.string().max(200) })
        .parse(await req.json());
      const expected = config().DASHBOARD_PASSWORD;
      if (
        Buffer.byteLength(body.password) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(body.password), Buffer.from(expected))
      ) {
        attempts.set(key, {
          count: (entry?.time && entry.time > Date.now() ? entry.count : 0) + 1,
          time: Date.now() + 900000,
        });
        return NextResponse.json(
          { error: "Incorrect dashboard password" },
          { status: 401 },
        );
      }
      const res = NextResponse.json({ ok: true });
      res.cookies.set("launchpad", token(), {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.COOKIE_SECURE === "true",
        path: "/",
        maxAge: 86400,
      });
      return res;
    }
    if (!validToken(req.cookies.get("launchpad")?.value || ""))
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (p === "health") {
      await db.$queryRaw`SELECT 1`;
      await postingQueue().client.then((c) => c.ping());
      return NextResponse.json({ ok: true });
    }
    if (p === "state" && req.method === "GET") {
      const [accounts, websites, proxies, jobs, profiles, hostReady] =
        await Promise.all([
          db.account.findMany({
            select: {
              id: true,
              name: true,
              username: true,
              website: true,
              proxyId: true,
              sessionPath: true,
              status: true,
              lastLoginAt: true,
              lastJobAt: true,
              lastError: true,
            },
          }),
          db.website.findMany(),
          db.proxy.findMany({
            select: {
              id: true,
              name: true,
              protocol: true,
              host: true,
              port: true,
              enabled: true,
            },
          }),
          db.postJob.findMany({
            take: 100,
            orderBy: { queuedAt: "desc" },
            include: {
              account: { select: { name: true } },
              website: { select: { name: true } },
            },
          }),
          db.browserProfile.findMany({
            select: {
              id: true,
              name: true,
              proxyId: true,
              status: true,
              mode: true,
              connectionMode: true,
              profilePath: true,
              profileExists: true,
              chromePid: true,
              lastOpenedAt: true,
              persistenceResult: true,
              persistenceCheckedAt: true,
              publicIp: true,
              ipCheckedAt: true,
              lastLoginAt: true,
              cookiesImportedAt: true,
              cookieCount: true,
              sessionStatus: true,
              sessionCheckedAt: true,
              sessionUsername: true,
              postStatus: true,
              postUrl: true,
              postError: true,
              lastError: true,
            },
            orderBy: { createdAt: "asc" },
          }),
          profileQueue().client.then((c) => c.get("browser-host-ready")),
        ]);
      return NextResponse.json({
        accounts: accounts.map((a) => ({
          ...a,
          sessionPath: undefined,
          hasSession: !!a.sessionPath,
        })),
        websites,
        proxies,
        jobs,
        profiles,
        browserHostReady: !!hostReady,
      });
    }
    if (p === "profiles" && req.method === "POST") {
      const body = z
        .object({
          name: z.string().trim().min(1).max(80),
          proxyId: z.string().nullable(),
        })
        .parse(await req.json());
      const profile = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(921718)`;
        if ((await tx.browserProfile.count()) >= 5)
          throw new Error(
            "This workspace supports at most five browser profiles",
          );
        if (
          body.proxyId &&
          !(await tx.proxy.findFirst({
            where: { id: body.proxyId, enabled: true },
          }))
        )
          throw new Error("Choose an enabled proxy");
        return tx.browserProfile.create({
          data: body,
          select: { id: true, name: true },
        });
      });
      return NextResponse.json(profile, { status: 201 });
    }
    if (p.startsWith("profiles/") && req.method === "POST") {
      const id = z
        .string()
        .regex(/^[a-zA-Z0-9-]+$/)
        .parse(p.split("/")[1]);
      const body = z
        .object({
          action: z.enum([
            "CREATE",
            "OPEN",
            "CLOSE",
            "OPEN_X",
            "IMPORT_COOKIES",
            "CONNECT_X",
            "POST_TEXT",
            "CHECK_LOGIN",
            "CHECK_IP",
            "TEST_PERSISTENCE",
            "CONNECTION",
            "RESET",
          ]),
          connectionMode: z.enum(["DIRECT", "PROXY"]).optional(),
          confirmation: z.string().optional(),
          cookies: z.string().max(200000).optional(),
          text: z.string().max(4000).optional(),
        })
        .parse(await req.json());
      const profile = await db.browserProfile.findUniqueOrThrow({
        where: { id },
      });
      if (body.action === "POST_TEXT") {
        validatePostText(body.text || "");
        if (profile.sessionStatus !== "VERIFIED" || !profile.sessionUsername)
          throw new Error("Connect your X account before posting");
        if (profile.postStatus === "POSTING") throw new Error("A browser operation is already in progress");
      }
      if (body.action === "OPEN" && profile.status === "RUNNING")
        return NextResponse.json(
          { error: `${profile.name} is already running.` },
          { status: 409 },
        );
      const redis = await profileQueue().client;
      if (!(await redis.get("browser-host-ready")))
        throw new Error(
          "Browser host is offline. Run ./run.command on this machine.",
        );
      if (!(await redis.set(`profile-operation:${id}`, "1", "EX", 180, "NX")))
        throw new Error("A browser operation is already in progress");
      try {
        if (
          body.action === "RESET" &&
          body.confirmation !==
            "This permanently deletes this browser's saved websites, cookies, and login sessions."
        ) {
          await redis.del(`profile-operation:${id}`);
          return NextResponse.json(
            { error: "Explicit reset confirmation is required" },
            { status: 400 },
          );
        }
        const { cookies, ...safeBody } = body;
        if ((body.action === "IMPORT_COOKIES" || body.action === "CONNECT_X")) {
          if (!cookies) throw new Error("Paste a valid JSON cookie export");
          parseXCookies(cookies);
        }
        if (body.action === "POST_TEXT") await db.browserProfile.update({
          where: { id }, data: { postStatus: "POSTING", postUrl: null, postError: null },
        });
        await profileQueue().add(
          "profile-action",
          {
            id,
            ...safeBody,
            ...(body.action === "POST_TEXT" ? { expectedUsername: profile.sessionUsername } : {}),
            ...(cookies && (body.action === "IMPORT_COOKIES" || body.action === "CONNECT_X")
              ? { encryptedCookies: encrypt(cookies) }
              : {}),
          },
          { removeOnComplete: true, removeOnFail: true },
        );
      } catch (error) {
        if (body.action === "POST_TEXT") await db.browserProfile.update({where: { id }, data: { postStatus: "FAILED", postError: "Post was not queued. Try again when the service is ready." }});
        await redis.del(`profile-operation:${id}`);
        if (error instanceof Error) throw error;
        throw new Error("Queue unavailable");
      }
      return NextResponse.json({
        ok: true,
        message: "Browser operation queued",
      });
    }
    if (p === "jobs" && req.method === "POST") {
      const body = z
        .object({
          accountId: z.string(),
          content: z.string().trim().min(1).max(5000),
          kind: z.enum(["POST", "LOGIN"]).default("POST"),
        })
        .parse(await req.json());
      const a = await db.account.findUniqueOrThrow({
        where: { id: body.accountId },
        include: { website: true },
      });
      if (!a.website.enabled) throw new Error("Website disabled");
      if (
        a.website.adapterType === "x-development" &&
        body.content.length > 280
      )
        throw new Error(
          "X posts are limited to 280 characters in this version",
        );
      if (
        a.website.adapterType === "x-development" &&
        (process.env.ENABLE_X_ADAPTER !== "true" ||
          process.env.AUTHORIZED_ACCOUNT !== "true")
      )
        throw new Error("Enable X and confirm account authorization in .env");
      const job = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${a.id} FOR UPDATE`;
        if (
          await tx.postJob.count({
            where: { accountId: a.id, status: { in: ["QUEUED", "RUNNING"] } },
          })
        )
          throw new Error("Account already has a queued or running job");
        return tx.postJob.create({ data: { ...body, websiteId: a.websiteId } });
      });
      try {
        await postingQueue().add(
          "browser-job",
          { id: job.id },
          { jobId: job.id },
        );
      } catch {
        await db.postJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            error: "Queue unavailable",

            completedAt: new Date(),
          },
        });
        throw new Error("Queue unavailable");
      }
      return NextResponse.json(job, { status: 201 });
    }
    if (p.startsWith("sessions/") && req.method === "DELETE") {
      const id = p.split("/")[1];
      if (
        await db.postJob.count({
          where: { accountId: id, status: { in: ["QUEUED", "RUNNING"] } },
        })
      )
        throw new Error("Wait for active jobs to finish");
      const account = await db.account.findUniqueOrThrow({ where: { id } });
      if (account.browserProfileId) {
        return NextResponse.json(
          {
            error:
              "Use Browsers → RESET PROFILE with confirmation to clear persistent browser data.",
          },
          { status: 400 },
        );
      }
      await unlink(sessionFile(id)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      await db.account.update({
        where: { id },
        data: { sessionPath: null, browserProfileId: null, status: "READY" },
      });
      return NextResponse.json({ ok: true });
    }
    if (p === "websites" && req.method === "POST") {
      const body = z
        .object({
          id: z.string().optional(),
          name: z.string().min(1).max(100),
          baseUrl: z.string().url(),
          adapterType: z.enum(["mock", "x-development"]),
          enabled: z.boolean(),
        })
        .parse(await req.json());
      if (
        body.adapterType === "x-development" &&
        body.baseUrl !== "https://x.com"
      )
        throw new Error("X adapter requires https://x.com");
      if (
        body.adapterType === "mock" &&
        body.baseUrl !== process.env.MOCK_BASE_URL
      )
        throw new Error("Mock adapter requires the configured MOCK_BASE_URL");
      const { id, ...data } = body;
      return NextResponse.json(
        id
          ? await db.website.update({ where: { id }, data })
          : await db.website.create({ data }),
      );
    }
    if (p === "proxies" && req.method === "POST") {
      const body = z
        .object({
          name: z.string().min(1).max(100),
          protocol: z.enum(["http", "https", "socks5"]),
          host: z.string().regex(/^[a-zA-Z0-9.-]+$/),
          port: z.coerce.number().int().min(1).max(65535),
          username: z.string().optional(),
          password: z.string().optional(),
        })
        .parse(await req.json());
      const { password, ...data } = body;
      const proxy = await db.proxy.create({
        data: {
          ...data,
          encryptedPassword: password ? encrypt(password) : null,
        },
      });
      return NextResponse.json({ id: proxy.id });
    }
    if (p.startsWith("proxies/") && req.method === "PATCH") {
      const { enabled } = z
        .object({ enabled: z.boolean() })
        .parse(await req.json());
      await db.proxy.update({
        where: { id: p.split("/")[1] },
        data: { enabled },
      });
      return NextResponse.json({ ok: true });
    }
    if (p.startsWith("accounts/") && req.method === "PATCH") {
      const body = z
        .object({ proxyId: z.string().nullable() })
        .parse(await req.json());
      await db.account.update({ where: { id: p.split("/")[1] }, data: body });
      return NextResponse.json({ ok: true });
    }
    if (p === "connection" && req.method === "POST") {
      const body = z
        .object({ proxyId: z.string().optional() })
        .parse(await req.json());
      const proxy = body.proxyId
        ? await db.proxy.findUniqueOrThrow({ where: { id: body.proxyId } })
        : undefined;
      const browser = await launch(proxy);
      try {
        const page = await browser.newPage();
        await page.goto("https://example.com", { timeout: 15000 });
        return NextResponse.json({
          ok: true,
          mode:
            proxy?.enabled || process.env.PROXY_SERVER
              ? "Proxy connection"
              : "Direct connection",
        });
      } finally {
        await browser.close();
      }
    }
    if (p.startsWith("screenshots/") && req.method === "GET") {
      const id = p.split("/")[1];
      const job = await db.postJob.findUniqueOrThrow({ where: { id } });
      if (!job.screenshot) return new NextResponse(null, { status: 404 });
      return new NextResponse(
        new Uint8Array(
          await readFile(join(config().dataDir, "screenshots", job.screenshot)),
        ),
        {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        },
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    const message =
      e instanceof z.ZodError
        ? "Invalid input"
        : e instanceof Error &&
            [
              "Queue unavailable",
              "Write a post first",
              "Posting is enabled for Browser 1 only",
              "Connect your X account before posting",
              "Paste a valid JSON cookie export",
              "Cookie export is too large",
              "Cookie export must be a JSON array with name, value and domain fields",
              "Only x.com and twitter.com cookies are accepted",
              "Cookie export contains duplicate entries",
              "Cookie export contains expired cookies. Export a current session",
              "SameSite=None cookies must be secure",
              "Export x.com cookies including auth_token from your signed-in browser",
              "This workspace supports at most five browser profiles",
              "Choose an enabled proxy",
              "Browser host is offline. Run ./run.command on this machine.",
              "A browser operation is already in progress",
              "This account uses a saved browser profile. Save login in a different profile to change its proxy.",
              "Account already has a queued or running job",
              "Wait for active jobs to finish",
              "Website disabled",
              "X posts are limited to 280 characters in this version",
              "Enable X and confirm account authorization in .env",
              "X adapter requires https://x.com",
              "Mock adapter requires the configured MOCK_BASE_URL",
            ].includes(e.message)
          ? e.message
          : "Operation failed. Check configuration and service health.";
    return NextResponse.json(
      { error: message },
      { status: p === "health" ? 503 : 400 },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
