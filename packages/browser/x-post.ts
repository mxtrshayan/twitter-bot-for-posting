import type { Page } from "playwright";
import { assertXIdentity } from "./adapters";
export class XSessionError extends Error {
  constructor(message: string, public readonly sessionStatus: "REJECTED" | "CHECK_FAILED") { super(message); }
}
export async function waitForXAccount(page: Page, timeout = 45000) {
  const account = page.locator('[data-testid="SideNav_AccountSwitcher_Button"]');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const path = new URL(page.url()).pathname;
    if (/^\/i\/flow\/(login|signup)/.test(path) || await page.locator('input[autocomplete="username"]').isVisible() || await page.getByRole('textbox', {name:/Email or username/i}).isVisible())
      throw new XSessionError("X has signed this browser out. Connect this account again with fresh cookies, then retry.", "REJECTED");
    if (/^\/(account\/access|i\/flow\/(challenge|verify))/.test(path))
      throw new XSessionError("X requires account verification. Complete it in your regular browser and import fresh cookies.", "REJECTED");
    if (await account.isVisible()) return;
    if (await page.getByRole("button", {name:"Try again",exact:true}).first().isVisible())
      throw new XSessionError("X could not load its application. Saved cookies are preserved. Use Recheck connection.", "CHECK_FAILED");
    await page.waitForTimeout(250);
  }
  throw new XSessionError("X did not finish loading the account. Saved cookies are preserved. Check the proxy connection and use Recheck connection.", "CHECK_FAILED");
}
export async function prepareXAccount(page: Page) {
  try { await waitForXAccount(page); }
  catch (error) {
    if (!(error instanceof XSessionError) || error.sessionStatus === "REJECTED") throw error;
    const cdp = await page.context().newCDPSession(page);
    try { await cdp.send("Network.clearBrowserCache"); } finally { await cdp.detach(); }
    await page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      for (const key of await caches.keys()) await caches.delete(key);
    }).catch(() => {});
    await page.reload({waitUntil:"domcontentloaded",timeout:30000});
    await waitForXAccount(page);
  }
}
export function validatePostText(text: string) {
  if (!text.trim()) throw new Error("Write a post first");
  if (Array.from(text).length > 280) throw new Error("X posts are limited to 280 characters in this version");
  return text;
}
export async function publishXPost(page: Page, text: string, username: string, onSubmit: () => void, onStage: (stage: string) => void = () => {}) {
  validatePostText(text);
  onStage("account control");
  await prepareXAccount(page);
  onStage("account identity");
  try { await assertXIdentity(page, username.replace(/^@/, "")); }
  catch { throw new XSessionError("This browser is signed in to a different account. Reconnect the intended account before posting.", "REJECTED"); }
  const newPost = page.locator('[data-testid="SideNav_NewTweet_Button"]');
  let composer: import("playwright").Page | import("playwright").Locator = page;
  if (await newPost.isVisible()) {
    onStage("open composer");
    await newPost.click();
    const dialog = page.getByRole("dialog").filter({ has: page.locator('[data-testid="tweetTextarea_0"]') }).last();
    onStage("composer dialog");
    await dialog.waitFor({timeout:30000});
    composer = dialog;
  }
  onStage("fill editor");
  await composer.locator('[data-testid="tweetTextarea_0"]:visible').last().fill(text);
  const button = composer.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first();
  onStage("post button");
  await button.waitFor({ timeout: 30000 });
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
    return buttons.some(button => button.getClientRects().length && !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true");
  }, undefined, {timeout:30000});
  onStage("submit post");
  onSubmit();
  await button.click({ timeout: 15000 });
  onStage("publication confirmation");
  const link = page.locator('[data-testid="toast"] a[href*="/status/"]').first();
  await link.waitFor({ timeout: 45000 });
  const href = await link.getAttribute("href");
  if (!href) throw new Error("Missing publication link");
  const url = new URL(href, "https://x.com");
  if (url.origin !== "https://x.com" || !/^\/[a-zA-Z0-9_]+\/status\/\d+$/.test(url.pathname)) throw new Error("Invalid publication link");
  if (url.pathname.split("/")[1].toLowerCase() !== username.replace(/^@/, "").toLowerCase()) throw new Error("Publication link did not match the selected account");
  return url.href;
}
