import { describe, expect, it } from "vitest";
import {
  browserIds,
  getProfilePath,
  resetConfirmation,
  PersistentProfiles,
} from "../packages/browser/persistent-profiles";
describe("permanent browser mappings", () => {
  it("maps exactly five IDs to distinct permanent project paths", () => {
    const paths = browserIds.map((id) => getProfilePath(id));
    expect(new Set(paths).size).toBe(5);
    expect(getProfilePath("browser-1")).toMatch(
      /data\/browser-profiles\/browser-1$/,
    );
    expect(getProfilePath("browser-2")).not.toBe(getProfilePath("browser-1"));
    expect(() => getProfilePath("../personal/Default")).toThrow();
    expect(() => getProfilePath("browser-6")).toThrow();
  });
  it("requires explicit confirmation before reset touches the filesystem", async () => {
    const profiles = new PersistentProfiles();
    await expect(profiles.reset("browser-1", "yes")).rejects.toThrow(
      "Explicit reset confirmation",
    );
    expect(resetConfirmation).toContain("permanently deletes");
  });
});
