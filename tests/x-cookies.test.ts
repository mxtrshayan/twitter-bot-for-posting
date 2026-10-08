import { expect, it } from "vitest";
import { parseXCookies } from "../packages/browser/x-cookies";
const cookie = {
  name: "auth_token",
  value: "fixture-only",
  domain: ".x.com",
  path: "/",
  expirationDate: Date.now() / 1000 + 3600,
  secure: true,
  httpOnly: true,
  sameSite: "no_restriction",
};
it("normalizes EditThisCookie exports and storage-state wrappers", () => {
  expect(parseXCookies(JSON.stringify([cookie]))[0]).toMatchObject({
    sameSite: "None",
    expires: cookie.expirationDate,
    httpOnly: true,
  });
  expect(
    parseXCookies(
      JSON.stringify({
        cookies: [{ ...cookie, sameSite: "unspecified", session: true }],
      }),
    )[0],
  ).toMatchObject({ sameSite: "Lax", expires: -1 });
});
it("rejects other domains, expired cookies and missing authentication", () => {
  expect(() =>
    parseXCookies(JSON.stringify([{ ...cookie, domain: "x.com.evil.test" }])),
  ).toThrow("Only x.com");
  expect(() =>
    parseXCookies(JSON.stringify([{ ...cookie, expirationDate: 1 }])),
  ).toThrow("expired");
  expect(() =>
    parseXCookies(JSON.stringify([{ ...cookie, name: "other" }])),
  ).toThrow("auth_token");
  expect(() => parseXCookies("not-json secret-value")).toThrow("valid JSON");
});
it("rejects duplicate and insecure SameSite=None imports", () => {
  expect(() => parseXCookies(JSON.stringify([cookie, cookie]))).toThrow(
    "duplicate",
  );
  expect(() =>
    parseXCookies(JSON.stringify([{ ...cookie, secure: false }])),
  ).toThrow("must be secure");
});

it("accepts extension metadata, host cookies and skips expired optional cookies", () => {
  const cookies = parseXCookies(JSON.stringify([
    { ...cookie, hostOnly: false, storeId: "0", id: 1 },
    { ...cookie, name: "__cf_bm", expirationDate: 1 },
    { ...cookie, name: "__cuid", sameSite: "unspecified", secure: false },
    { ...cookie, name: "__cuid", domain: "x.com", hostOnly: true, sameSite: "unspecified", secure: false },
    { name: "lang", value: "en", domain: "x.com", hostOnly: true, session: true, secure: false, sameSite: "unspecified" },
  ]));
  expect(cookies).toHaveLength(4);
  expect(cookies.filter(c => c.name === "__cuid")).toHaveLength(2);
  expect(cookies.find(c => c.name === "lang")).toMatchObject({ expires: -1, sameSite: "Lax" });
});
