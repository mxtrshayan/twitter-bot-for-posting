import { processIdentity } from "../packages/browser/process-identity";
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { connection } from "../packages/shared/queue";
const redis = connection();
const timeout=setTimeout(()=>process.exit(1),4000);
try {
  const owner=JSON.parse(await readFile("data/browser-host-owner.json","utf8"));
  const ready=await redis.get("browser-host-ready");
  if(ready!==owner.token || !owner.identity || await processIdentity(owner.pid)!==owner.identity) process.exitCode=1;
} catch { process.exitCode=1; }
finally { clearTimeout(timeout); redis.disconnect(); }
