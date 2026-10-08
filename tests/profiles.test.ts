import { beforeAll, describe, it, expect } from "vitest";
import { extractIp } from "../packages/browser/profiles";
import { proxyOptions } from "../packages/browser/runtime";
import { encrypt, decrypt } from "../packages/shared/security";
beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://localhost/test";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  process.env.DASHBOARD_PASSWORD = "test-dashboard-password";
});
describe("browser profiles", () => {
  it("validates IPv4 and IPv6 from provider responses", () => {
    expect(extractIp({ ip: "203.0.113.1" })).toBe("203.0.113.1");
    expect(extractIp({ ip_address: "2001:db8::1" })).toBe("2001:db8::1");
    expect(() => extractIp({ ip: "not-an-ip" })).toThrow();
    expect(() => extractIp(null)).toThrow();
  });
  it("keeps explicitly direct profiles independent of environment proxy defaults", () => {
    process.env.PROXY_SERVER = "http://configured.example:8000";
    expect(proxyOptions(null, false)).toBeUndefined();
    expect(proxyOptions()).toEqual({
      server: "http://configured.example:8000",
      username: process.env.PROXY_USERNAME || undefined,
      password: process.env.PROXY_PASSWORD || undefined,
    });
    delete process.env.PROXY_SERVER;
  });
  it("refuses a disabled assigned proxy instead of falling back", () => {
    process.env.PROXY_SERVER = "http://fallback.example:8000";
    expect(() =>
      proxyOptions({
        protocol: "http",
        host: "assigned.example",
        port: 8000,
        username: null,
        encryptedPassword: null,
        enabled: false,
      }),
    ).toThrow("Assigned proxy is disabled");
    delete process.env.PROXY_SERVER;
  });
  it("keeps separate encrypted authentication snapshots", () => {
    const first = encrypt(
      JSON.stringify({ cookies: [{ name: "auth", value: "first" }] }),
    );
    const second = encrypt(
      JSON.stringify({ cookies: [{ name: "auth", value: "second" }] }),
    );
    expect(JSON.parse(decrypt(first)).cookies[0].value).toBe("first");
    expect(JSON.parse(decrypt(second)).cookies[0].value).toBe("second");
    expect(first).not.toContain("first");
  });
});
