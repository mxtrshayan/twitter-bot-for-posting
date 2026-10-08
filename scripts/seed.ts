import "dotenv/config";
import { db } from "../packages/database";
import { config } from "../packages/shared/config";
config();
async function main() {
  const mock = await db.website.upsert({
    where: { id: "mock" },
    update: {
      baseUrl: process.env.MOCK_BASE_URL || "http://localhost:3000/mock",
    },
    create: {
      id: "mock",
      name: "Local test website",
      baseUrl: process.env.MOCK_BASE_URL || "http://localhost:3000/mock",
      adapterType: "mock",
    },
  });
  await db.account.upsert({
    where: { id: "mock-account" },
    update: {},
    create: {
      id: "mock-account",
      name: "Local test account",
      username: "test@example.com",
      websiteId: mock.id,
    },
  });
  for (let n = 1; n <= 5; n++) {
    await db.browserProfile.upsert({
      where: { id: `browser-${n}` },
      update: {},
      create: {
        id: `browser-${n}`,
        name: `Browser ${n}`,
        connectionMode: "DIRECT",
        mode: "VISIBLE",
      },
    });
  }
  if (process.env.ENABLE_X_ADAPTER === "true") {
    const x = await db.website.upsert({
      where: { id: "x" },
      update: {},
      create: {
        id: "x",
        name: "X / Twitter",
        baseUrl: "https://x.com",
        adapterType: "x-development",
      },
    });
    await db.account.upsert({
      where: { id: "x-account" },
      update: { username: process.env.ACCOUNT_USERNAME || "" },
      create: {
        id: "x-account",
        name: "Authorized X account",
        username: process.env.ACCOUNT_USERNAME || "",
        websiteId: x.id,
      },
    });
  }
}
main().finally(() => db.$disconnect());
