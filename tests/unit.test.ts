import { beforeAll, describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  token,
  validToken,
} from "../packages/shared/security";
import { proxyOptions } from "../packages/browser/runtime";
beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://localhost/test";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  process.env.DASHBOARD_PASSWORD = "test-dashboard-password";
  delete process.env.PROXY_SERVER;
});
describe("secrets and sessions", () => {
  it("isolates fixture sessions from dashboard sessions", () => {
    const fixture = token("mock");
    expect(validToken(fixture, "mock")).toBe(true);
    expect(validToken(fixture)).toBe(false);
    expect(validToken(token(), "mock")).toBe(false);
  });
  it("encrypts with authenticated encryption and a unique nonce", () => {
    const a = encrypt("secret");
    expect(a).not.toContain("secret");
    expect(decrypt(a)).toBe("secret");
    expect(encrypt("secret")).not.toBe(a);
  });
  it("rejects altered ciphertext", () => {
    const a = encrypt("secret").split(":");
    a[1] = "00";
    expect(() => decrypt(a.join(":"))).toThrow();
  });
  it("accepts signed cookies and rejects tampering", () => {
    const t = token();
    expect(validToken(t)).toBe(true);
    expect(validToken(t + "a")).toBe(false);
    expect(validToken("")).toBe(false);
  });
  it("launches direct without a proxy", () =>
    expect(proxyOptions()).toBeUndefined());
  it("supports encrypted proxy passwords", () =>
    expect(
      proxyOptions({
        enabled: true,
        protocol: "http",
        host: "localhost",
        port: 8000,
        username: "test",
        encryptedPassword: encrypt("secret"),
      }),
    ).toEqual({
      server: "http://localhost:8000",
      username: "test",
      password: "secret",
    }));
});
