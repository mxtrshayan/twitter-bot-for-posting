import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { db } from "../packages/database";
import { postingQueue } from "../packages/shared/queue";
import { config } from "../packages/shared/config";
import { MockAdapter } from "../packages/browser/adapters";
import { token } from "../packages/shared/security";
import {
  saveSession,
  loadSession,
  sessionFile,
} from "../packages/browser/runtime";
config();
const base = process.env.MOCK_BASE_URL || "http://localhost:3000/mock";
const site = new MockAdapter(base);
const browser = await chromium.launch({ headless: true });
try {
  assert.equal(
    (
      await fetch("http://localhost:3000/api/state", {
        headers: { Cookie: `launchpad=${token("mock")}` },
      })
    ).status,
    401,
  );
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  assert.equal(await site.isAuthenticated(p), false);
  await site.login(p, "test@example.com", "test-password");
  await saveSession("integration", await ctx.storageState());
  assert.ok(
    !(await readFile(sessionFile("integration"), "utf8")).includes(
      "mock-session",
    ),
  );
  const before = await db.mockPost.count({
    where: { content: "Pakistan Zindabad" },
  });
  await site.navigateToComposer(p);
  await site.enterPost(p, "Pakistan Zindabad");
  await site.publishPost(p);
  await site.verifyPostPublished(p, "Pakistan Zindabad");
  assert.equal(
    await db.mockPost.count({ where: { content: "Pakistan Zindabad" } }),
    before + 1,
  );
  await ctx.close();
  console.log(
    "PASS: direct Chromium, login, encrypted storage state, first post",
  );
  const restored = await browser.newContext({
    storageState: await loadSession("integration"),
  });
  const p2 = await restored.newPage();
  assert.equal(await site.isAuthenticated(p2), true);
  const second = `Session restored ${Date.now()}`;
  await site.navigateToComposer(p2);
  await site.enterPost(p2, second);
  await site.publishPost(p2);
  await site.verifyPostPublished(p2, second);
  await restored.close();
  console.log("PASS: fresh context, restored login, second post");
  const page = await browser.newPage();
  assert.equal((await fetch("http://localhost:3000/api/state")).status, 401);
  await page.goto("http://localhost:3000");
  await page
    .getByLabel("Dashboard password")
    .fill(process.env.DASHBOARD_PASSWORD!);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .getByRole("heading", { name: "A little less busywork." })
    .waitFor();
  assert.equal(
    (await page.request.get("http://localhost:3000/api/health")).status(),
    200,
  );
  assert.equal((await fetch("http://localhost:3001")).status, 200);
  await page.getByRole("button", { name: "Create post", exact: true }).click();
  await page.getByLabel("Authorized account").selectOption("mock-account");
  const text = `Queue integration ${Date.now()}`;
  await page.getByLabel("Post content").fill(text);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  let result;
  for (let i = 0; i < 60; i++) {
    result = await db.postJob.findFirst({ where: { content: text } });
    if (
      result &&
      ["SUCCESS", "FAILED", "REQUIRES_MANUAL_ACTION"].includes(result.status)
    )
      break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(
    result?.status,
    "SUCCESS",
    result?.error || "Worker did not complete job",
  );
  await page
    .getByText("SUCCESS", { exact: true })
    .first()
    .waitFor({ timeout: 10000 });
  const safeState = await (
    await page.request.get("http://localhost:3000/api/state")
  ).text();
  assert.ok(!safeState.includes("encryptedPassword"));
  assert.ok(!safeState.includes(process.env.APP_ENCRYPTION_KEY!));
  assert.equal(
    (
      await page.request.post("http://localhost:3000/api/jobs", {
        data: { accountId: "mock-account", content: "" },
        headers: { Origin: "http://localhost:3000" },
      })
    ).status(),
    400,
  );
  assert.equal(
    (
      await page.request.post("http://localhost:3000/api/jobs", {
        data: { accountId: "mock-account", content: "blocked" },
        headers: { Origin: "https://untrusted.example" },
      })
    ).status(),
    403,
  );
  console.log(
    "PASS: unauthenticated access, input validation, cross-origin protection, no encrypted credentials in API",
  );
  const fixtureId = `failure-${Date.now()}`;
  const website = await db.website.create({
    data: {
      id: fixtureId,
      name: "Failure fixture",
      baseUrl: base,
      adapterType: "missing-test-adapter",
    },
  });
  const fixture = await db.account.create({
    data: {
      id: fixtureId,
      name: "Failure fixture",
      username: "test@example.com",
      websiteId: website.id,
    },
  });
  const failedJob = await db.postJob.create({
    data: {
      accountId: fixture.id,
      websiteId: website.id,
      content: "Failure test",
      kind: "LOGIN",
    },
  });
  try {
    await postingQueue().add(
      "browser-job",
      { id: failedJob.id },
      { jobId: failedJob.id },
    );
    let failure;
    for (let i = 0; i < 30; i++) {
      failure = await db.postJob.findUniqueOrThrow({
        where: { id: failedJob.id },
      });
      if (failure.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert.equal(failure?.status, "FAILED");
    assert.ok(failure?.screenshot);
    assert.equal(
      (
        await page.request.get(
          `http://localhost:3000/api/screenshots/${failedJob.id}`,
        )
      ).status(),
      200,
    );
    assert.equal(
      (await fetch(`http://localhost:3000/api/screenshots/${failedJob.id}`))
        .status,
      401,
    );
    console.log(
      "PASS: worker failure result, screenshot capture, authenticated artifact access",
    );
  } finally {
    await db.postJob.delete({ where: { id: failedJob.id } });
    await db.account.delete({ where: { id: fixture.id } });
    await db.website.delete({ where: { id: website.id } });
  }
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({
    path: "/tmp/launchpad-dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("heading", { name: "Authorized accounts" }).waitFor();
  await page.screenshot({ path: "/tmp/launchpad-mobile.png", fullPage: true });
  console.log("PASS: responsive navigation and dark theme");
  console.log(
    "PASS: dashboard login and rendering, health endpoints, API → BullMQ → worker → Chromium → mock post",
  );
} finally {
  await browser.close();
  const queue = postingQueue();
  const redis = await queue.client;
  await queue.close();
  await redis.quit();
  await db.$disconnect();
}
