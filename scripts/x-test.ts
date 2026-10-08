import "dotenv/config";
import { db } from "../packages/database";
import { postingQueue } from "../packages/shared/queue";
import { config } from "../packages/shared/config";
config();
if (
  process.env.ENABLE_X_ADAPTER !== "true" ||
  process.env.AUTHORIZED_ACCOUNT !== "true"
)
  throw new Error(
    "Enable the X adapter and confirm account authorization in .env first.",
  );
const account = await db.account.findUniqueOrThrow({
  where: { id: "x-account" },
  include: { website: true },
});
const queue = postingQueue();
async function run(kind: "LOGIN" | "POST", content: string) {
  const record = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${account.id} FOR UPDATE`;
    if (
      await tx.postJob.count({
        where: { accountId: account.id, status: { in: ["QUEUED", "RUNNING"] } },
      })
    )
      throw new Error(
        "This account already has an active job. Inspect Jobs before proceeding.",
      );
    return tx.postJob.create({
      data: {
        accountId: account.id,
        websiteId: account.websiteId,
        kind,
        content,
      },
    });
  });
  try {
    await queue.add("browser-job", { id: record.id }, { jobId: record.id });
  } catch {
    await db.postJob.update({
      where: { id: record.id },
      data: {
        status: "FAILED",
        error: "Queue unavailable",
        completedAt: new Date(),
      },
    });
    throw new Error("Queue unavailable");
  }
  console.log(`${kind} job queued: ${record.id}`);
  for (let i = 0; i < 180; i++) {
    const result = await db.postJob.findUniqueOrThrow({
      where: { id: record.id },
    });
    if (
      ["SUCCESS", "FAILED", "REQUIRES_MANUAL_ACTION"].includes(result.status)
    ) {
      console.log(
        JSON.stringify(
          {
            id: result.id,
            status: result.status,
            error: result.error,
            lastUrl: result.lastUrl,
            publishedUrl: result.publishedUrl,
            logs: result.logs,
            screenshot: result.screenshot
              ? `http://localhost:3000/api/screenshots/${result.id}`
              : null,
          },
          null,
          2,
        ),
      );
      return result.status === "SUCCESS";
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    "Job did not finish in time. Inspect Jobs; do not repeat a post with an uncertain outcome.",
  );
}
try {
  if (await run("LOGIN", "X login test")) {
    if (!(await run("POST", "Pakistan Zindabad"))) process.exitCode = 1;
  } else {
    console.log("Posting skipped because login did not succeed.");
    process.exitCode = 1;
  }
} finally {
  const redis = await queue.client;
  await queue.close();
  await redis.quit();
  await db.$disconnect();
}
