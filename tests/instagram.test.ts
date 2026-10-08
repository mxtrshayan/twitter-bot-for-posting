import { describe, it, expect } from "vitest";
import { instagramSessionMarkers } from "../packages/browser/instagram";
const cookies = [
  { name: "sessionid", value: "fixture-session", domain: ".instagram.com" },
  { name: "ds_user_id", value: "fixture-user", domain: ".instagram.com" },
];
describe("Instagram login session detection", () => {
  it("requires both Instagram session markers on its own origin", () => {
    expect(instagramSessionMarkers("https://www.instagram.com/", cookies)).toBe(
      true,
    );
    expect(
      instagramSessionMarkers(
        "https://www.instagram.com/",
        cookies.slice(0, 1),
      ),
    ).toBe(false);
    expect(instagramSessionMarkers("https://example.com/", cookies)).toBe(
      false,
    );
    expect(
      instagramSessionMarkers(
        "https://www.instagram.com/",
        cookies.map((c) => ({ ...c, domain: "example.com" })),
      ),
    ).toBe(false);
  });
  it("does not save sessions still in login, challenge or checkpoint flows", () => {
    for (const path of ["accounts/login/", "challenge/", "checkpoint/"])
      expect(
        instagramSessionMarkers(`https://www.instagram.com/${path}`, cookies),
      ).toBe(false);
  });
});
