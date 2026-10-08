import { chromium, type LaunchOptions } from "playwright";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../shared/config";
import { encrypt, decrypt } from "../shared/security";
export function proxyOptions(
  proxy?: {
    protocol: string;
    host: string;
    port: number;
    username: string | null;
    encryptedPassword: string | null;
    enabled: boolean;
  } | null,
  allowEnvironmentProxy = true,
): LaunchOptions["proxy"] {
  if (proxy && !proxy.enabled) throw new Error("Assigned proxy is disabled");
  if (proxy?.enabled)
    return {
      server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
      username: proxy.username || undefined,
      password: proxy.encryptedPassword
        ? decrypt(proxy.encryptedPassword)
        : undefined,
    };
  if (allowEnvironmentProxy && process.env.PROXY_SERVER)
    return {
      server: process.env.PROXY_SERVER,
      username: process.env.PROXY_USERNAME || undefined,
      password: process.env.PROXY_PASSWORD || undefined,
    };
  return undefined;
}
export const hostBrowserOptions: LaunchOptions = {
  channel: process.platform === "darwin" ? "chrome" : "chromium",
  chromiumSandbox: true,
};
export const sessionFile = (id: string) =>
  join(config().dataDir, "sessions", `${id}.enc`);
export async function loadSession(id: string) {
  try {
    return JSON.parse(decrypt(await readFile(sessionFile(id), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
export async function saveSession(id: string, state: unknown) {
  await mkdir(join(config().dataDir, "sessions"), {
    recursive: true,
    mode: 0o700,
  });
  await chmod(join(config().dataDir, "sessions"), 0o700);
  const temporary = `${sessionFile(id)}.${randomUUID()}.tmp`;
  await writeFile(temporary, encrypt(JSON.stringify(state)), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, sessionFile(id));
}
export async function launch(
  proxy?: Parameters<typeof proxyOptions>[0],
  allowEnvironmentProxy = true,
) {
  const c = config();
  return chromium.launch({
    headless: c.HEADLESS === "true",
    timeout: Math.min(c.JOB_TIMEOUT_MS, 30000),
    slowMo: c.SLOW_MO,
    proxy: proxyOptions(proxy, allowEnvironmentProxy),
  });
}
