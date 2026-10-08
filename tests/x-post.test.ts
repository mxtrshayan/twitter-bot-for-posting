import { expect, it } from "vitest";
import { validatePostText } from "../packages/browser/x-post";
it("preserves post text and rejects empty or oversized posts", () => {
  expect(validatePostText("Honesty is the best policy.")).toBe("Honesty is the best policy.");
  expect(() => validatePostText("  ")).toThrow("Write a post");
  expect(() => validatePostText("a".repeat(281))).toThrow("280");
  expect(validatePostText("😀".repeat(280))).toHaveLength(560);
});
