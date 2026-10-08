import "dotenv/config";
import assert from "node:assert/strict";
import { db } from "../packages/database";
import { profileQueue } from "../packages/shared/queue";
import { token } from "../packages/shared/security";
const q = profileQueue();
const saved = await db.browserProfile.findUniqueOrThrow({where: {id:"browser-2"},select:{postStatus:true,postUrl:true,postError:true}});
let job: Awaited<ReturnType<typeof q.getJobs>>[number] | undefined;
const headers = {"Content-Type":"application/json", Origin:"http://localhost:3000", Cookie:`launchpad=${token()}`};
try {
  await q.pause();
  const empty = await fetch("http://localhost:3000/api/profiles/browser-2",{method:"POST",headers,body:JSON.stringify({action:"POST_TEXT",text:" "})});
  assert.equal(empty.status,400);
  const r = await fetch("http://localhost:3000/api/profiles/browser-2",{method:"POST",headers,body:JSON.stringify({action:"POST_TEXT",text:"queue-fixture-remove-before-execution"})});
  assert.equal(r.status,200);
  job = (await q.getJobs(["waiting","paused"])).find(j=>j.data.action==="POST_TEXT" && j.data.text==="queue-fixture-remove-before-execution");
  assert(job);
  assert.equal(job.data.id,"browser-2");
  assert(job.data.expectedUsername);
  const duplicate = await fetch("http://localhost:3000/api/profiles/browser-2",{method:"POST",headers,body:JSON.stringify({action:"POST_TEXT",text:"second-fixture"})});
  assert.equal(duplicate.status,400);
  await job.remove(); job=undefined;
  console.log("PASS: Browser 2 posting API validates text, binds connected identity and blocks a concurrent submission. Synthetic queued post removed before execution; no actual post published.");
} finally {
  if(job) await job.remove();
  await db.browserProfile.update({where:{id:"browser-2"},data:saved});
  const client=await q.client;
  await client.del("profile-operation:browser-2");
  await q.resume(); await q.close(); await client.quit(); await db.$disconnect();
}
