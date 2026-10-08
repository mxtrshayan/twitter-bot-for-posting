import { isIP } from "node:net";
import type { BrowserContext } from "playwright";
export function extractIp(data: unknown): string {
  if (!data || typeof data !== "object")
    throw new Error("IP endpoint returned invalid data");
  const d = data as Record<string, unknown>;
  for (const key of ["ip", "ip_address", "address"]) {
    const value = d[key];
    if (typeof value === "string" && isIP(value)) return value;
  }
  throw new Error("IP endpoint did not return an IP address");
}
export async function inspectIp(
  context: BrowserContext,
  url = "https://ip.oxylabs.io/location",
) {
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { timeout: 20000 });
    if (!response?.ok()) throw new Error("IP endpoint refused the request");
    return extractIp(JSON.parse(await page.locator("body").innerText()));
  } finally {
    await page.close();
  }
}
