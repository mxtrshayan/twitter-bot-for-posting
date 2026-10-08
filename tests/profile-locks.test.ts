import { expect, it } from "vitest";
import { mkdtemp, realpath, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PersistentProfiles } from "../packages/browser/persistent-profiles";
import { processIdentity } from "../packages/browser/process-identity";
type Locker = { acquireLock(id: "browser-1"): Promise<string>; releaseLock(id: "browser-1", token: string): Promise<void> };
it("protects a live owner but recovers a reused PID with a different process identity", async context => {
  const identity = await processIdentity(process.pid);
  if (!identity) { context.skip(); return; }
  const root = await realpath(await mkdtemp(join(tmpdir(), "launchpad-lock-test-")));
  try {
    const first = new PersistentProfiles(root) as unknown as Locker;
    const second = new PersistentProfiles(root) as unknown as Locker;
    const token = await first.acquireLock("browser-1");
    await expect(second.acquireLock("browser-1")).rejects.toThrow("already running");
    const path = join(root, ".locks", "browser-1.json");
    await writeFile(path, JSON.stringify({pid: process.pid, token, identity:"previous-process-start"}));
    const replacement = await second.acquireLock("browser-1");
    expect(replacement).not.toBe(token);
    await first.releaseLock("browser-1", token);
    expect(JSON.parse(await readFile(path,"utf8")).token).toBe(replacement);
    await second.releaseLock("browser-1", replacement);
  } finally { await rm(root, {recursive:true,force:true}); }
});
