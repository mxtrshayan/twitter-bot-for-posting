import "dotenv/config";
import assert from "node:assert/strict";
import { profileQueue } from "../packages/shared/queue";
import { token, decrypt } from "../packages/shared/security";
const queue = profileQueue();
let fixtureJob: Awaited<ReturnType<typeof queue.getJobs>>[number] | undefined;
const raw = JSON.stringify([
  {
    name: "auth_token",
    value: "queue-fixture-no-real-login",
    domain: ".x.com",
    path: "/",
    secure: true,
    httpOnly: true,
    expirationDate: Date.now() / 1000 + 3600,
  },
]);
try {
  await queue.pause();
  const response = await fetch("http://localhost:3000/api/profiles/browser-5", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      Cookie: `launchpad=${token()}`,
    },
    body: JSON.stringify({ action: "CONNECT_X", cookies: raw }),
  });
  assert.equal(response.status, 200);
  const jobs = await queue.getJobs(["waiting", "paused"]);
  fixtureJob = jobs.find(
    (job) =>
      job.data.id === "browser-5" &&
      job.data.action === "CONNECT_X" &&
      job.data.encryptedCookies &&
      decrypt(job.data.encryptedCookies) === raw,
  );
  assert(fixtureJob, "No encrypted import job found");
  assert(
    !JSON.stringify(fixtureJob.data).includes("queue-fixture-no-real-login"),
  );
  assert.equal(fixtureJob.data.cookies, undefined);
  await fixtureJob.remove();
  fixtureJob = undefined;
  console.log(
    "PASS: authenticated cookie-import API queues encrypted payload only. Fixture job removed before processing; no real profile cookies or X requests changed.",
  );
} finally {
  if (fixtureJob) await fixtureJob.remove();
  const client = await queue.client;
  await client.del("profile-operation:browser-5");
  await queue.resume();
  await queue.close();
  await client.quit();
}
