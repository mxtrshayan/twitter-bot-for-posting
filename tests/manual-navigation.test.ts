import { expect, it } from "vitest";
import { safeBrowserFailure } from "../packages/browser/manual-navigation";
it("reports only safe network codes rather than raw connection details", () => {
  expect(
    safeBrowserFailure(
      new Error(
        "https://private-user:private-password@example.com net::ERR_HTTP_RESPONSE_CODE_FAILURE",
      ),
    ),
  ).toBe("net::ERR_HTTP_RESPONSE_CODE_FAILURE");
  expect(safeBrowserFailure(new Error("private-password"))).toBe(
    "connection failure",
  );
});
