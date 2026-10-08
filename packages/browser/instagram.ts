import type { Page } from "playwright";
export function instagramSessionMarkers(
  url: string,
  cookies: { name: string; value: string; domain: string }[],
) {
  const location = new URL(url);
  if (location.origin !== "https://www.instagram.com") return false;
  if (/^\/(accounts|challenge|checkpoint)(\/|$)/.test(location.pathname))
    return false;
  return ["sessionid", "ds_user_id"].every((name) =>
    cookies.some(
      (cookie) =>
        cookie.name === name &&
        !!cookie.value &&
        [".instagram.com", "instagram.com", "www.instagram.com"].includes(
          cookie.domain,
        ),
    ),
  );
}
export async function isInstagramSessionReady(page: Page) {
  return (
    instagramSessionMarkers(
      page.url(),
      await page.context().cookies("https://www.instagram.com"),
    ) && !(await page.locator('input[name="password"]').isVisible())
  );
}
