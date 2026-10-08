import "dotenv/config";
import { chromium } from "playwright";
import { db } from "../packages/database";
import { hostBrowserOptions, proxyOptions } from "../packages/browser/runtime";
import { openManualLoginPage } from "../packages/browser/manual-navigation";
import { inspectIp } from "../packages/browser/profiles";
let browser;
let phase = "launch";
try {
  const profile = await db.browserProfile.findUniqueOrThrow({
    where: { id: "browser-1" },
    include: { proxy: true },
  });
  browser = await chromium.launch({
    ...hostBrowserOptions,
    headless: false,
    proxy: proxyOptions(profile.proxy, false),
  });
  const context = await browser.newContext({ acceptDownloads: false });
  phase = "proxy IP check";
  console.log("IP check:", await inspectIp(context));
  phase = "Instagram navigation";
  const page = await context.newPage();
  page.on("response", (response) => {
    if (
      response.request().isNavigationRequest() &&
      response.frame() === page.mainFrame()
    )
      console.log("Document HTTP status:", response.status());
  });
  await openManualLoginPage(page, "INSTAGRAM");
  console.log("Instagram navigation completed:", new URL(page.url()).pathname);
  console.log(
    "Login input count:",
    await page.locator('input[name="username"]').count(),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      phase,
      error:
        error instanceof Error
          ? error.message.match(/net::[A-Z_]+/)?.[0] ||
            (error.name === "TimeoutError"
              ? "TimeoutError"
              : "Operation failed")
          : "Operation failed",
    }),
  );
} finally {
  await browser?.close();
  await db.$disconnect();
}
