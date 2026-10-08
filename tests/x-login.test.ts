import { describe, expect, it } from "vitest";
import { isXLoginRestrictionText } from "../packages/browser/adapters";
describe("X login restriction reporting", () => {
  it("detects the reported message across whitespace and casing", () => {
    expect(
      isXLoginRestrictionText(
        "We have temporarily   LIMITED your login. Please try again later.",
      ),
    ).toBe(true);
    expect(isXLoginRestrictionText("Too many login attempts")).toBe(true);
  });
  it("does not classify an ordinary login form or generic temporary error as a login restriction", () => {
    expect(
      isXLoginRestrictionText("Sign in to X Username Password Log in"),
    ).toBe(false);
    expect(
      isXLoginRestrictionText("Temporarily unavailable. Try again later."),
    ).toBe(false);
  });
});
