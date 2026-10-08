import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../packages/database";
import { profileQueue } from "../packages/shared/queue";
import {
  browserIds,
  getProfilePath,
  isProcessAlive,
} from "../packages/browser/persistent-profiles";
const execute = promisify(execFile);
const before = await Promise.all(
  browserIds.map((id) => stat(getProfilePath(id))),
);
const queue = profileQueue();
await queue.add("control-test-open", { id: "browser-1", action: "OPEN" });
let chromePid: number | null = null;
for (let count = 0; count < 60; count++) {
  const row = await db.browserProfile.findUniqueOrThrow({
    where: { id: "browser-1" },
  });
  if (row.status === "RUNNING" && row.chromePid) {
    chromePid = row.chromePid;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert(chromePid, "Chrome did not open before stop test");
const client = await queue.client;
await queue.close();
await client.quit();
await db.$disconnect();
await execute("./stop.command", [], { timeout: 180000 });
assert.equal(isProcessAlive(chromePid), false, "Stop left Chrome running");
for (const [index, id] of browserIds.entries()) {
  assert.equal((await stat(getProfilePath(id))).ino, before[index].ino);
  await access(join(getProfilePath(id), "Local State"));
  await access(join(getProfilePath(id), "Default", "Preferences"));
}
console.log(
  "PASS: ./stop.command gracefully exited actual visible Chrome and preserved all five profile directories.",
);
await execute("./run.command", [], { timeout: 180000 });
const profiles = await db.browserProfile.findMany();
assert.equal(profiles.length, 5);
assert(
  profiles.every(
    (profile) =>
      profile.profileExists &&
      profile.status === "STOPPED" &&
      profile.connectionMode === "DIRECT",
  ),
);
for (const [index, id] of browserIds.entries())
  assert.equal((await stat(getProfilePath(id))).ino, before[index].ino);
await db.$disconnect();
console.log(
  "PASS: ./run.command starts healthy Docker services and the host with the same five directories; all modes remain DIRECT.",
);
