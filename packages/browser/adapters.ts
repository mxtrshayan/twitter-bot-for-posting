import type { Page } from "playwright";
export class ManualAction extends Error {}
export interface SiteAdapter {
  login(page: Page, username: string, password: string): Promise<void>;
  isAuthenticated(page: Page): Promise<boolean>;
  navigateToComposer(page: Page): Promise<void>;
  enterPost(page: Page, text: string): Promise<void>;
  publishPost(page: Page): Promise<void>;
  verifyPostPublished(page: Page, text: string): Promise<string>;
}
export class MockAdapter implements SiteAdapter {
  constructor(private base: string) {}
  async isAuthenticated(p: Page) {
    await p.goto(`${this.base}/dashboard`);
    return p.url().endsWith("/dashboard");
  }
  async login(p: Page, u: string, pw: string) {
    await p.goto(`${this.base}/login`);
    await p.getByLabel("Email").fill(u);
    await p.getByLabel("Password").fill(pw);
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForURL(`${this.base}/dashboard`);
  }
  async navigateToComposer(p: Page) {
    await p.goto(`${this.base}/create-post`);
  }
  async enterPost(p: Page, t: string) {
    await p.getByLabel("Post content").fill(t);
  }
  async publishPost(p: Page) {
    await p.getByRole("button", { name: "Publish", exact: true }).click();
    await p.waitForURL(`${this.base}/posts`);
  }
  async verifyPostPublished(p: Page, t: string) {
    await p.getByText(t, { exact: true }).first().waitFor();
    return p.url();
  }
}
export function isXLoginRestrictionText(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  return /temporarily limited your login|too many login attempts|temporarily locked out/.test(
    normalized,
  );
}
export async function hasXLoginRestriction(page: Page) {
  if (new URL(page.url()).origin !== "https://x.com") return false;
  return isXLoginRestrictionText(
    await page.locator("body").innerText({ timeout: 2000 }),
  );
}
export async function isXSessionReady(p: Page) {
  if (new URL(p.url()).origin !== "https://x.com") return false;
  return p
    .locator('[data-testid="SideNav_AccountSwitcher_Button"]')
    .isVisible();
}
export async function assertXIdentity(p: Page, username: string) {
  const identity = await p
    .locator('[data-testid="SideNav_AccountSwitcher_Button"]')
    .innerText();
  if (
    !identity
      .split(/\s+/)
      .some((part) => part.toLowerCase() === `@${username.toLowerCase()}`)
  )
    throw new ManualAction(
      "The signed-in X account does not match ACCOUNT_USERNAME. Clear the session and log into the configured account.",
    );
}
export class XDevelopmentAdapter implements SiteAdapter {
  private publishedHref?: string;
  constructor(private username: string) {}
  async isAuthenticated(p: Page) {
    await p.goto("https://x.com/home");
    try {
      await p
        .locator('[data-testid="SideNav_AccountSwitcher_Button"]')
        .waitFor({ timeout: 10000 });
    } catch {
      return false;
    }
    await assertXIdentity(p, this.username);
    return true;
  }
  async login(p: Page, u: string, pw: string) {
    try {
      await p.goto("https://x.com/i/flow/login");
      await p.locator('input[autocomplete="username"]').fill(u);
      await p.getByRole("button", { name: "Next", exact: true }).click();
      await p.locator('input[name="password"]').waitFor({ timeout: 10000 });
      await p.locator('input[name="password"]').fill(pw);
      await p.getByRole("button", { name: "Log in", exact: true }).click();
      await p
        .locator('[data-testid="SideNav_AccountSwitcher_Button"]')
        .waitFor({ timeout: 15000 });
      await assertXIdentity(p, this.username);
    } catch {
      throw new ManualAction(
        "X requires manual login or a challenge. Run npm run login on the host, complete login, then retry.",
      );
    }
  }
  async navigateToComposer(p: Page) {
    await assertXIdentity(p, this.username);
    await p.goto("https://x.com/compose/post");
    await p.locator('[data-testid="tweetTextarea_0"]').waitFor();
  }
  async enterPost(p: Page, t: string) {
    await p.locator('[data-testid="tweetTextarea_0"]').fill(t);
  }
  async publishPost(p: Page) {
    await p.locator('[data-testid="tweetButton"]').click();
    const link = p.locator('[data-testid="toast"] a[href*="/status/"]').first();
    await link.waitFor({ timeout: 15000 });
    this.publishedHref = (await link.getAttribute("href")) || undefined;
  }
  async verifyPostPublished(p: Page, text: string) {
    if (!this.publishedHref)
      throw new Error("Publication could not be verified");
    const url = new URL(this.publishedHref, "https://x.com");
    if (url.origin !== "https://x.com" || !url.pathname.includes("/status/"))
      throw new Error("Invalid publication URL");
    await p.goto(url.href);
    await p
      .locator('article [data-testid="tweetText"]')
      .filter({ hasText: text })
      .first()
      .waitFor({ timeout: 15000 });
    return url.href;
  }
}
export function adapter(
  type: string,
  base: string,
  username: string,
): SiteAdapter {
  if (type === "mock") return new MockAdapter(base);
  if (
    type === "x-development" &&
    process.env.ENABLE_X_ADAPTER === "true" &&
    process.env.AUTHORIZED_ACCOUNT === "true"
  )
    return new XDevelopmentAdapter(username);
  throw new Error("Adapter disabled or account authorization not confirmed");
}
