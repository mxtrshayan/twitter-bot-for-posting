import "dotenv/config";
import assert from "node:assert/strict";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  PersistentProfiles,
  browserIds,
  getProfilePath,
  isProcessAlive,
  type BrowserId,
} from "../packages/browser/persistent-profiles";
import {
  fixtureOrigin,
  startPersistenceFixture,
  writeFixture,
  readFixture,
} from "../packages/browser/persistence-fixture";
const server = await startPersistenceFixture();
const events: string[] = [];
const exited = new Set<string>();
const manager = new PersistentProfiles(
  undefined,
  (event) => events.push(event.event),
  async (id) => {
    exited.add(id);
  },
);
const direct = { mode: "DIRECT" as const };
try {
  const one = await manager.open("browser-1", direct);
  const two = await manager.open("browser-2", direct);
  assert.notEqual(one.pid, two.pid);
  assert.notEqual(one.profilePath, two.profilePath);
  await assert.rejects(
    manager.open("browser-1", direct),
    /Browser 1 is already running/,
  );
  const otherHost = new PersistentProfiles();
  await assert.rejects(otherHost.open("browser-1", direct), /already running/);
  const p1 = await manager.navigate(
    "browser-1",
    `${fixtureOrigin}/history/browser-1`,
  );
  const p2 = await manager.navigate(
    "browser-2",
    `${fixtureOrigin}/history/browser-2`,
  );
  await writeFixture(p1, "browser1");
  await writeFixture(p2, "browser2");
  assert.deepEqual(await readFixture(p1), {
    cookie: "browser1",
    localStorage: "browser1",
    indexedDB: "browser1",
  });
  assert.deepEqual(await readFixture(p2), {
    cookie: "browser2",
    localStorage: "browser2",
    indexedDB: "browser2",
  });
  await manager.close("browser-1");
  await manager.close("browser-2");
  assert.equal(isProcessAlive(one.pid), false);
  assert.equal(isProcessAlive(two.pid), false);
  await access(join(one.profilePath, "Default", "Preferences"));
  await access(join(two.profilePath, "Default", "Preferences"));
  const firstReopened = await manager.open("browser-1", direct);
  const secondReopened = await manager.open("browser-2", direct);
  assert.notEqual(firstReopened.pid, one.pid);
  const r1 = await manager.navigate(
    "browser-1",
    `${fixtureOrigin}/history/browser-1`,
  );
  const r2 = await manager.navigate(
    "browser-2",
    `${fixtureOrigin}/history/browser-2`,
  );
  assert.deepEqual(await readFixture(r1), {
    cookie: "browser1",
    localStorage: "browser1",
    indexedDB: "browser1",
  });
  assert.deepEqual(await readFixture(r2), {
    cookie: "browser2",
    localStorage: "browser2",
    indexedDB: "browser2",
  });
  console.log(
    "PASS: actual visible Chrome Browser 1 and Browser 2 retain independent cookies, localStorage and IndexedDB after full process exit/reopen.",
  );
  await r1.route("http://navigation-failure.test/**", (route) =>
    route.abort("failed"),
  );
  await assert.rejects(
    manager.navigate("browser-1", "http://navigation-failure.test/"),
    /Navigation failed/,
  );
  assert.equal(manager.live.get("browser-1")!.pid, firstReopened.pid);
  await access(one.profilePath);
  await r1.unroute("http://navigation-failure.test/**");
  // Simulate the operator closing the final Chrome window, not a dashboard close.
  for (const page of secondReopened.context.pages()) await page.close();
  for (let count = 0; count < 100 && manager.live.has("browser-2"); count++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(manager.live.has("browser-2"), false);
  assert(exited.has("browser-2"));
  await manager.close("browser-1");
  const history = await readFile(join(one.profilePath, "Default", "History"));
  assert(
    history.includes(Buffer.from(`${fixtureOrigin}/history/browser-1`)),
    "Chrome history did not persist on disk",
  );
  await assert.rejects(
    manager.open("browser-1", { mode: "PROXY" }),
    /enabled proxy/,
  );
  await access(one.profilePath);
  // An unreachable proxy may let Chrome launch; failure occurs on actual navigation.
  let proxyEntry;
  try {
    proxyEntry = await manager.open("browser-1", {
      mode: "PROXY",
      proxyId: "local-unreachable-fixture",
      proxy: { server: "http://127.0.0.1:1" },
    });
    await assert.rejects(
      manager.navigate("browser-1", "https://example.test/"),
      /Navigation failed/,
    );
    await access(one.profilePath);
  } finally {
    await manager.close("browser-1");
  }
  assert(proxyEntry);
  await manager.open("browser-1", direct);
  const afterProxy = await manager.navigate(
    "browser-1",
    `${fixtureOrigin}/history/browser-1`,
  );
  assert.deepEqual(await readFixture(afterProxy), {
    cookie: "browser1",
    localStorage: "browser1",
    indexedDB: "browser1",
  });
  await manager.close("browser-1");
  // All five real directories must contain Chrome-generated state, not just empty folders.
  for (const id of browserIds.slice(2)) {
    await manager.open(id as BrowserId, direct);
    await manager.navigate(id as BrowserId, `${fixtureOrigin}/history/${id}`);
    await manager.close(id as BrowserId);
  }
  for (const id of browserIds) {
    const path = getProfilePath(id);
    assert.equal(await realpath(path), path);
    assert.equal((await stat(path)).mode & 0o777, 0o700);
    await access(join(path, "Local State"));
    await access(join(path, "Default", "Preferences"));
  }
  assert.equal(new Set(browserIds.map((id) => getProfilePath(id))).size, 5);
  assert.equal(manager.live.size, 0);
  console.log(
    "PASS: different PIDs, same-profile duplicate locks, manual-window closure, persistent history, navigation/proxy failure preservation, DIRECT→PROXY→DIRECT preservation, and five independent real on-disk Chrome profiles.",
  );
  assert(events.includes("navigation-failed"));
} finally {
  for (const id of [...manager.live.keys()])
    await manager.close(id).catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
