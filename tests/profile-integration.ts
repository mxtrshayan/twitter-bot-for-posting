import "dotenv/config";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { chromium } from "playwright";
import { db } from "../packages/database";
const browser = await chromium.launch({ headless: true });
async function waitProfile(
  id: string,
  check: (
    profile: Awaited<ReturnType<typeof db.browserProfile.findUniqueOrThrow>>,
  ) => boolean,
) {
  for (let count = 0; count < 120; count++) {
    const profile = await db.browserProfile.findUniqueOrThrow({
      where: { id },
    });
    if (check(profile)) return profile;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Profile operation did not finish: ${id}`);
}
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:3000");
  await page
    .getByLabel("Dashboard password")
    .fill(process.env.DASHBOARD_PASSWORD!);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page
    .getByRole("heading", { name: "Independent browser profiles" })
    .waitFor();
  const state = await (
    await page.request.get("http://localhost:3000/api/state")
  ).json();
  assert(state.browserHostReady);
  assert.equal(state.profiles.length, 5);
  assert(!JSON.stringify(state).includes("encryptedSession"));
  assert(!JSON.stringify(state).includes("encryptedPassword"));
  for (const name of [
    "OPEN BROWSER",
    "CLOSE BROWSER",
    "OPEN X",
    "OPEN INSTAGRAM",
    "OPEN GOOGLE",
    "TEST PERSISTENCE",
    "CREATE PROFILE",
    "RESET PROFILE",
  ])
    assert.equal(
      await page.getByRole("button", { name, exact: true }).count(),
      5,
    );
  assert.equal(
    await page.getByRole("button", { name: "X login", exact: true }).count(),
    0,
  );
  assert.equal(
    new Set(
      state.profiles.map(
        (profile: { profilePath: string }) => profile.profilePath,
      ),
    ).size,
    5,
  );
  assert(
    state.profiles.every(
      (profile: { profileExists: boolean }) => profile.profileExists,
    ),
  );
  const capped = await page.request.post("http://localhost:3000/api/profiles", {
    headers: { Origin: "http://localhost:3000" },
    data: { name: "Sixth profile", proxyId: null },
  });
  assert.equal(capped.status(), 400);
  const noConfirmation = await page.request.post(
    "http://localhost:3000/api/profiles/browser-1",
    { headers: { Origin: "http://localhost:3000" }, data: { action: "RESET" } },
  );
  assert.equal(noConfirmation.status(), 400);
  async function action(id: string, action: string, extra = {}) {
    const response = await page.request.post(
      `http://localhost:3000/api/profiles/${id}`,
      {
        headers: { Origin: "http://localhost:3000" },
        data: { action, ...extra },
      },
    );
    assert.equal(response.status(), 200);
  }
  // Connection selection must only change metadata, never profile contents.
  const path = state.profiles.find(
    (profile: { id: string }) => profile.id === "browser-3",
  ).profilePath;
  const originalInode = (await stat(path)).ino;
  await action("browser-3", "CONNECTION", { connectionMode: "PROXY" });
  await waitProfile(
    "browser-3",
    (profile) => profile.connectionMode === "PROXY",
  );
  assert.equal((await stat(path)).ino, originalInode);
  await action("browser-3", "CONNECTION", { connectionMode: "DIRECT" });
  await waitProfile(
    "browser-3",
    (profile) => profile.connectionMode === "DIRECT",
  );
  assert.equal((await stat(path)).ino, originalInode);
  for (const profile of state.profiles) await action(profile.id, "OPEN");
  for (const profile of state.profiles)
    await waitProfile(
      profile.id,
      (row) => row.status === "RUNNING" && !!row.chromePid && !!row.publicIp,
    );
  let profiles = await db.browserProfile.findMany();
  assert.equal(new Set(profiles.map((profile) => profile.chromePid)).size, 5);
  assert(profiles.every((profile) => profile.connectionMode === "DIRECT"));
  const duplicateOpen = await page.request.post(
    "http://localhost:3000/api/profiles/browser-1",
    { headers: { Origin: "http://localhost:3000" }, data: { action: "OPEN" } },
  );
  assert.equal(duplicateOpen.status(), 409);
  assert.equal(
    (await duplicateOpen.json()).error,
    "Browser 1 is already running.",
  );
  const beforeSwitch = profiles.find((profile) => profile.id === "browser-1")!;
  await action("browser-1", "CONNECTION", { connectionMode: "PROXY" });
  await waitProfile(
    "browser-1",
    (row) =>
      row.lastError === "Close the browser before changing its connection mode",
  );
  assert.equal(
    (await db.browserProfile.findUniqueOrThrow({ where: { id: "browser-1" } }))
      .chromePid,
    beforeSwitch.chromePid,
  );
  await page.getByText("RUNNING", { exact: true }).first().waitFor();
  for (
    let count = 0;
    count < 20 &&
    (await page.getByText("RUNNING", { exact: true }).count()) !== 5;
    count++
  )
    await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await page.getByText("RUNNING", { exact: true }).count(), 5);
  await page.screenshot({
    path: "/tmp/launchpad-persistent-browsers.png",
    fullPage: true,
  });
  for (const profile of profiles) await action(profile.id, "CLOSE");
  for (const profile of profiles)
    await waitProfile(
      profile.id,
      (row) => row.status === "STOPPED" && row.chromePid === null,
    );
  for (const id of ["browser-1", "browser-2"]) {
    const before = await db.browserProfile.findUniqueOrThrow({ where: { id } });
    await action(id, "TEST_PERSISTENCE");
    const row = await waitProfile(
      id,
      (row) =>
        !!row.persistenceCheckedAt &&
        row.persistenceCheckedAt.getTime() >
          (before.persistenceCheckedAt?.getTime() || 0),
    );
    assert(
      row.persistenceResult?.startsWith("PASS"),
      row.persistenceResult || "No persistence result",
    );
    assert.equal(row.status, "RUNNING");
    await action(id, "CLOSE");
    await waitProfile(id, (row) => row.status === "STOPPED");
  }
  profiles = await db.browserProfile.findMany();
  assert(
    profiles.every(
      (profile) => profile.profileExists && profile.status === "STOPPED",
    ),
  );
  console.log(
    "PASS: five persistent browser cards and distinct live PIDs; protected API, reset confirmation, duplicate-open refusal, connection toggle preserves directories; Browser 1/2 persistence tests passed through the dashboard/host queue. No third-party login attempted.",
  );
} finally {
  await browser.close();
  await db.$disconnect();
}
