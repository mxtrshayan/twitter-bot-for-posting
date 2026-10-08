import type { Page, Response } from "playwright";
import { ManualAction } from "./adapters";
export function safeBrowserFailure(error: unknown) {
  if (!(error instanceof Error)) return "connection failure";
  return (
    error.message.match(/net::[A-Z_]+/)?.[0] ||
    (error.name === "TimeoutError"
      ? "navigation timeout"
      : "connection failure")
  );
}
export async function openManualLoginPage(page: Page, site: "X" | "INSTAGRAM") {
  const name = site === "INSTAGRAM" ? "Instagram" : "X";
  let documentStatus: number | undefined;
  const captureStatus = (response: Response) => {
    if (
      response.request().isNavigationRequest() &&
      response.frame() === page.mainFrame()
    )
      documentStatus = response.status();
  };
  page.on("response", captureStatus);
  try {
    const response = await page.goto(
      site === "INSTAGRAM"
        ? "https://www.instagram.com/accounts/login/"
        : "https://x.com/i/flow/login",
      { timeout: 30000, waitUntil: "domcontentloaded" },
    );
    if (response && response.status() >= 400)
      throw new ManualAction(
        `${name} returned HTTP ${response.status()}. The browser stays open for inspection. No automatic retry was made.`,
      );
  } catch (error) {
    if (error instanceof ManualAction) throw error;
    if (documentStatus && documentStatus >= 400)
      throw new ManualAction(
        `${name} returned HTTP ${documentStatus}${documentStatus === 429 ? " (too many requests)" : ""}. The browser stays open for inspection. No automatic retry was made.`,
      );
    throw new ManualAction(
      `${name} login page could not load (${safeBrowserFailure(error)}). The browser stays open for inspection. Check the assigned proxy's access to ${name}; no automatic retry was made.`,
    );
  } finally {
    page.off("response", captureStatus);
  }
}
