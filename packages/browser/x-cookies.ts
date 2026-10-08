import { z } from "zod";
import type { BrowserContext } from "playwright";
export function isXCookieDomain(domain: string) {
  return /^(?:\.)?(?:[a-z0-9-]+\.)*(?:x\.com|twitter\.com)$/i.test(domain);
}
export function parseXCookies(raw: string) {
  if (Buffer.byteLength(raw) > 200000)
    throw new Error("Cookie export is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Paste a valid JSON cookie export");
  }
  const input = Array.isArray(parsed)
    ? parsed
    : (parsed as { cookies?: unknown } | null)?.cookies;
  const rows = z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        value: z.string().max(16384),
        domain: z.string().min(1).max(253),
        path: z.string().startsWith("/").max(2048).default("/"),
        secure: z.boolean().default(true),
        httpOnly: z.boolean().default(false),
        expirationDate: z.number().finite().optional(),
        expires: z.number().finite().optional(),
        sameSite: z.string().optional(),
        session: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(100)
    .safeParse(input);
  if (!rows.success)
    throw new Error(
      "Cookie export must be a JSON array with name, value and domain fields",
    );
  const seen = new Set<string>();
  const cookies = rows.data.flatMap((row) => {
    if (!isXCookieDomain(row.domain))
      throw new Error("Only x.com and twitter.com cookies are accepted");
    const key = `${row.domain}:${row.path}:${row.name}`;
    if (seen.has(key))
      throw new Error("Cookie export contains duplicate entries");
    seen.add(key);
    const expiry = row.session ? -1 : (row.expirationDate ?? row.expires ?? -1);
    if (expiry !== -1 && expiry <= Date.now() / 1000) {
      if (row.name === "auth_token")
        throw new Error(
          "Cookie export contains expired cookies. Export a current session",
        );
      return [];
    }
    const site = row.sameSite?.toLowerCase();
    const sameSite: "None" | "Strict" | "Lax" =
      site === "strict"
        ? "Strict"
        : site === "none" || site === "no_restriction"
          ? "None"
          : "Lax";
    if (sameSite === "None" && !row.secure)
      throw new Error("SameSite=None cookies must be secure");
    return [{
      name: row.name,
      value: row.value,
      domain: row.domain.toLowerCase(),
      path: row.path,
      expires: expiry,
      secure: row.secure,
      httpOnly: row.httpOnly,
      sameSite,
    }];
  });
  if (
    !cookies.some(
      (cookie) =>
        cookie.name === "auth_token" &&
        !!cookie.value &&
        /^(\.)?x\.com$/.test(cookie.domain),
    )
  )
    throw new Error(
      "Export x.com cookies including auth_token from your signed-in browser",
    );
  return cookies;
}
export async function exportXCookies(context: BrowserContext) {
  return (await context.cookies()).filter((cookie) =>
    isXCookieDomain(cookie.domain),
  );
}
