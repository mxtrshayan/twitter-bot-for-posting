import assert from "node:assert/strict";
import { chromium } from "playwright";
import { publishXPost, waitForXAccount, XSessionError } from "../packages/browser/x-post";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<button data-testid="SideNav_AccountSwitcher_Button">Test Account @fixture</button>
    <div role="dialog">Unrelated loading dialog</div>
    <button data-testid="SideNav_NewTweet_Button" onclick="document.querySelector('#modal').style.display='block'">New post</button><div id="modal" role="dialog" style="display:none">
    <div data-testid="tweetTextarea_0" contenteditable="true"></div>
    <button data-testid="tweetButton" onclick="window.clicks=(window.clicks||0)+1;document.querySelector('#result').innerHTML='<div data-testid=toast><a href=https://x.com/fixture/status/123>View</a></div>'">Post</button><div id="result"></div></div>`);
  let submitted = false;
  await assert.rejects(publishXPost(page, "Honesty is the best policy.", "@other", () => { submitted = true; }));
  assert.equal(submitted, false);
  const url = await publishXPost(page, "Honesty is the best policy.", "@fixture", () => { submitted = true; });
  assert.equal(url, "https://x.com/fixture/status/123");
  assert.equal(await page.locator('[data-testid="tweetTextarea_0"]').innerText(), "Honesty is the best policy.");
  assert.equal(await page.evaluate(() => (window as unknown as {clicks:number}).clicks), 1);
  assert(submitted);
  await page.setContent('<input aria-label="Email or username"><button data-testid="tweetButton">Post</button>');
  submitted = false;
  await assert.rejects(publishXPost(page, "Hello brother", "@fixture", () => { submitted = true; }), error => error instanceof XSessionError && error.sessionStatus === "REJECTED");
  assert.equal(submitted, false);
  await page.setContent(`<p>Loading</p><script>setTimeout(() => document.body.innerHTML = '<button data-testid="SideNav_AccountSwitcher_Button">@fixture</button>', 600)</script>`);
  await waitForXAccount(page, 2000);
  await page.setContent('<button>Try again</button>');
  await assert.rejects(waitForXAccount(page, 500), error => error instanceof XSessionError && error.sessionStatus === "CHECK_FAILED");
  await page.setContent('<p>Unavailable</p>');
  await assert.rejects(waitForXAccount(page, 500), error => error instanceof XSessionError && error.sessionStatus === "CHECK_FAILED");
  let loads = 0;
  await page.route('https://fixture.invalid/**', route => {
    loads++;
    return route.fulfill({contentType:'text/html',body:loads===1 ? '<button>Try again</button>' : `<button data-testid="SideNav_AccountSwitcher_Button">@fixture</button><div data-testid="tweetTextarea_0" contenteditable="true"></div><button data-testid="tweetButtonInline" onclick="window.clicks=(window.clicks||0)+1;document.getElementById('result').innerHTML='<div data-testid=toast><a href=https://x.com/fixture/status/456>View</a></div>'">Post</button><div id="result"></div>`});
  });
  await page.goto('https://fixture.invalid/home');
  submitted = false;
  assert.equal(await publishXPost(page,'Recovery fixture','@fixture',()=>{submitted=true;}),'https://x.com/fixture/status/456');
  assert.equal(loads,2);
  assert.equal(await page.evaluate(()=>(window as unknown as {clicks:number}).clicks),1);
  assert(submitted);
  console.log("PASS: composer fills exact text, rejects wrong identity before clicking, submits once, and returns a confirmed post link. Local fixture only; no real post published.");
} finally { await browser.close(); }
