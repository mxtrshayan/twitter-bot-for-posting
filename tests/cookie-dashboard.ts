import "dotenv/config";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://localhost:3000");
  await page.getByLabel("Dashboard password").fill(process.env.DASHBOARD_PASSWORD!);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.getByTestId("browser-card-browser-1").waitFor();
  assert.equal(await page.locator('[data-testid^="browser-card-"]').count(), 5);
  assert.equal(await page.getByText(/Instagram|X Session Desk/).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save cookies", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Check X login", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Cookie JSON").count(), 0);
  assert.equal(await page.locator("textarea#post-text").count(), 1);
  const initialState = await page.request.get("http://localhost:3000/api/state").then(r => r.json());
  const fixtureState = {...initialState, profiles: initialState.profiles.map((profile: {id:string;sessionUsername:string|null}) => ["browser-1","browser-2"].includes(profile.id) ? {...profile,sessionStatus:"VERIFIED",postStatus:"NONE",postError:null,sessionUsername:profile.sessionUsername || (profile.id === "browser-1" ? "@fixture_one" : "@fixture_two")} : profile)};
  await page.route("**/api/state", route => route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(fixtureState)}));
  await page.reload();
  await page.getByTestId("browser-card-browser-1").waitFor();
  const accountSelector = page.getByLabel("Post to account");
  const options = await accountSelector.locator("option").allTextContents();
  assert(options.some(option => option.includes("Browser 1")));
  assert(options.some(option => option.includes("Browser 2")));
  assert.equal(await page.locator('[data-testid^="browser-card-"] textarea').count(), 0);
  await accountSelector.selectOption("browser-2");
  let submitted: {action: string; text: string} | undefined;
  await page.route("**/api/profiles/browser-2", async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true})});
  });
  await page.locator("textarea#post-text").fill("Shared composer routing fixture");
  await page.getByRole("button", {name:/^Post to /}).click();
  await page.waitForTimeout(300);
  assert.deepEqual(submitted, {action:"POST_TEXT",text:"Shared composer routing fixture"});
  await page.unroute("**/api/profiles/browser-2");
  await page.locator("textarea#post-text").fill("a".repeat(281));
  assert(await page.getByRole("button", {name:/^Post to /}).isDisabled());
  await page.locator("textarea#post-text").fill("");
  await page.getByTestId("browser-card-browser-3").getByRole("button", { name: "Connect X account" }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByLabel("Cookie JSON").fill("not-json-fixture");
  await page.getByRole("button", { name: "Connect account", exact: true }).click();
  await page.getByRole("dialog").getByText("Paste a valid JSON cookie export", {exact:true}).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.getByRole("dialog").count(), 0);
  const response = await page.request.post("http://localhost:3000/api/profiles/browser-3", {
    headers: { Origin: "https://untrusted.example" },
    data: { action: "CONNECT_X", cookies: "[]" },
  });
  assert.equal(response.status(), 403);
  const originalState = fixtureState;
  await page.unroute("**/api/state");
  const rejectedState = {...originalState, profiles: originalState.profiles.map((profile: {id:string}) => profile.id === "browser-2" ? {...profile,sessionStatus:"REJECTED",postStatus:"FAILED",postError:"X has signed this browser out. Connect this account again with fresh cookies, then retry."} : profile)};
  await page.route("**/api/state", route => route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(rejectedState)}));
  await page.getByText("Browser 2: X has signed this browser out. Connect this account again with fresh cookies, then retry.", {exact:true}).waitFor({timeout:10000});
  assert.equal(await accountSelector.locator('option[value="browser-2"]').count(), 0);
  assert.equal(await page.getByText("Posting through Browser 2…", {exact:true}).count(), 0);
  await page.unroute("**/api/state");
  await page.screenshot({ path: "/tmp/launchpad-dashboard.png", fullPage: true });
  console.log("PASS: five simple browser cards, cookie dialog, validation and origin protection. Existing sessions preserved; no X requests made.");
} finally { await browser.close(); }
