import "dotenv/config";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  hostBrowserOptions,
  loadSession,
  saveSession,
  sessionFile,
} from "../packages/browser/runtime";
import { isInstagramSessionReady } from "../packages/browser/instagram";
import { openManualLoginPage } from "../packages/browser/manual-navigation";
const originalDataDir = process.env.DATA_DIR;
const temporaryData = await mkdtemp(join(tmpdir(), "browser-security-"));
process.env.DATA_DIR = temporaryData;
const first = await chromium.launch({ ...hostBrowserOptions, headless: true });
let second;
try {
  second = await chromium.launch({ ...hostBrowserOptions, headless: true });
  const a = await first.newContext({ acceptDownloads: false });
  const b = await second.newContext({ acceptDownloads: false });
  await a.addCookies([
    {
      name: "isolation_test",
      value: "first-only",
      url: "https://example.test",
    },
  ]);
  assert.equal(
    (await b.cookies()).length,
    0,
    "Cookies leaked between browsers",
  );
  const page = await a.newPage();
  const cdp = await a.newCDPSession(page);
  const { arguments: args } = await cdp.send("Browser.getBrowserCommandLine");
  assert(!args.includes("--no-sandbox"), "Browser sandbox disabled");
  assert(
    !args.includes("--ignore-certificate-errors"),
    "Certificate checking disabled",
  );
  assert(!args.includes("--disable-web-security"), "Web security disabled");
  await page.route("https://example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Local security fixture</h1>",
    }),
  );
  await page.goto("https://example.test/");
  assert.equal(await page.locator("h1").innerText(), "Local security fixture");
  await page.route("https://www.instagram.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Instagram local fixture</h1>",
    }),
  );
  await openManualLoginPage(page, "INSTAGRAM");
  assert.equal(await page.locator("h1").innerText(), "Instagram local fixture");
  const failingPage = await a.newPage();
  await failingPage.route("https://www.instagram.com/**", (route) =>
    route.abort("failed"),
  );
  await assert.rejects(
    openManualLoginPage(failingPage, "INSTAGRAM"),
    /net::ERR_FAILED/,
  );
  assert(first.isConnected(), "Navigation failure closed the browser");
  await failingPage.close();
  const limitedPage = await a.newPage();
  await limitedPage.route("https://www.instagram.com/**", (route) =>
    route.fulfill({
      status: 429,
      contentType: "text/html",
      body: "<h1>Local rate-limit fixture</h1>",
    }),
  );
  await assert.rejects(
    openManualLoginPage(limitedPage, "INSTAGRAM"),
    /HTTP 429/,
  );
  assert(first.isConnected(), "HTTP refusal closed the browser");
  await limitedPage.close();
  console.log(
    "PASS: manual login navigation succeeds on local fixture; network and HTTP failures preserve the browser and produce actionable errors.",
  );
  await a.addCookies([
    {
      name: "sessionid",
      value: "local-session",
      domain: ".instagram.com",
      path: "/",
      secure: true,
    },
    {
      name: "ds_user_id",
      value: "local-user",
      domain: ".instagram.com",
      path: "/",
      secure: true,
    },
  ]);
  await page.goto("https://www.instagram.com/accounts/login/");
  assert.equal(await isInstagramSessionReady(page), false);
  await page.goto("https://www.instagram.com/");
  assert.equal(await isInstagramSessionReady(page), true);
  await page.goto("https://www.instagram.com/challenge/");
  assert.equal(await isInstagramSessionReady(page), false);
  await saveSession(
    "instagram-fixture",
    await a.storageState({ indexedDB: true }),
  );
  const restored = await second.newContext({
    storageState: await loadSession("instagram-fixture"),
  });
  assert(
    (await restored.cookies("https://www.instagram.com")).some(
      (cookie) => cookie.name === "sessionid",
    ),
  );
  assert.equal((await b.cookies("https://www.instagram.com")).length, 0);
  await restored.close();
  console.log(
    "PASS: Instagram local fixture login/challenge detection, encrypted restoration and profile isolation. No real Instagram request was sent.",
  );
  await saveSession("fixture", {
    cookies: [{ name: "auth", value: "private-fixture" }],
  });
  await saveSession("fixture", {
    cookies: [{ name: "auth", value: "replacement-fixture" }],
  });
  assert.equal(
    (await loadSession("fixture")).cookies[0].value,
    "replacement-fixture",
  );
  assert.equal((await stat(sessionFile("fixture"))).mode & 0o777, 0o600);
  assert.equal(
    (await stat(join(temporaryData, "sessions"))).mode & 0o777,
    0o700,
  );
  assert(
    !(await readFile(sessionFile("fixture"), "utf8")).includes(
      "replacement-fixture",
    ),
  );
  console.log(
    `PASS: Chrome ${first.version()}, sandbox launch enabled, certificate checks enabled, isolated cookies, local rendering, encrypted atomic session saves with private permissions. No Google/X login attempted.`,
  );
} finally {
  await second?.close();
  await first.close();
  await rm(temporaryData, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
}
