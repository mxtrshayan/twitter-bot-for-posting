import "dotenv/config";
import { db } from "../packages/database";
import { encrypt } from "../packages/shared/security";
if (!process.env.OXYLABS_USERNAME || !process.env.OXYLABS_PASSWORD)
  throw new Error("Set Oxylabs credentials securely in .env");
try {
  for (let n = 1; n <= 5; n++) {
    const id = `oxylabs-${n}`;
    const data = {
      name: `Oxylabs fixed endpoint ${n}`,
      host: "dc.oxylabs.io",
      protocol: "http",
      port: 8000 + n,
      username: process.env.OXYLABS_USERNAME,
      encryptedPassword: encrypt(process.env.OXYLABS_PASSWORD),
      enabled: true,
    };
    await db.proxy.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
    await db.browserProfile.upsert({
      where: { id: `browser-${n}` },
      update: {
        proxyId: id,
        connectionMode: "PROXY",
        mode: "HEADLESS",
        publicIp: null,
        ipCheckedAt: null,
      },
      create: {
        id: `browser-${n}`,
        name: `Browser ${n}`,
        proxyId: id,
        connectionMode: "PROXY",
        mode: "HEADLESS",
      },
    });
  }
  console.log(
    "Five candidate fixed provider endpoints and separate browser profiles configured. IP measurements will verify availability.",
  );
} finally {
  await db.$disconnect();
}
