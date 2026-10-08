import "dotenv/config";
import { token } from "../packages/shared/security";
const headers = { Cookie: `launchpad=${token()}` };
const sleep = () => new Promise(resolve => setTimeout(resolve, 1000));
type Profile = { id: string; status: string; publicIp: string | null; lastError: string | null };
async function state() {
  const response = await fetch("http://localhost:3000/api/state", { headers, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Dashboard not ready");
  return await response.json() as { browserHostReady: boolean; profiles: Profile[] };
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await state()).browserHostReady) { ready = true; break; } } catch {}
    await sleep();
  }
  if (!ready) throw new Error("Browser service did not become ready. See docker-compose logs browser-host.");
  for (const profile of (await state()).profiles) {
    if (profile.status === "RUNNING") continue;
    const response = await fetch(`http://localhost:3000/api/profiles/${profile.id}`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ action: "OPEN" }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const result=await response.json();
      if (response.status!==409 && result.error!=="A browser operation is already in progress")
        throw new Error(`Could not start ${profile.id}; HTTP ${response.status}.`);
    }
  }
  for (let attempt = 0; attempt < 120; attempt++) {
    const current = await state();
    if (!current.browserHostReady) throw new Error("Browser service stopped during startup.");
    if (current.profiles.length === 5 && current.profiles.every(profile => profile.status === "RUNNING" && profile.publicIp && !profile.lastError)) {
      console.log("Launchpad ready: dashboard, database, Redis and 5 background browsers online. http://localhost:3000");
      process.exit(0);
    }
    await sleep();
  }
  throw new Error("Not all browsers started successfully. Check browser cards and docker-compose logs browser-host.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Project startup failed.");
  process.exit(1);
}
