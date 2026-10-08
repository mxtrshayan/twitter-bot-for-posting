import { chromium } from 'playwright';
import { db } from '../packages/database';
import { decrypt } from '../packages/shared/security';
import { proxyOptions } from '../packages/browser/runtime';
import { inspectIp } from '../packages/browser/profiles';
for (const id of ['browser-1','browser-2']) {
  const row = await db.browserProfile.findUniqueOrThrow({where:{id},include:{proxy:true}});
  const browser = await chromium.launch({headless:false,chromiumSandbox:true,proxy:proxyOptions(row.proxy,false)});
  try {
    const context = await browser.newContext();
    const cookies = JSON.parse(decrypt(row.encryptedSession!)).cookies;
    await context.addCookies(cookies.filter((c:{expires:number})=>c.expires===-1 || c.expires>Date.now()/1000));
    const ip = await inspectIp(context);
    const page = await context.newPage();
    const response = await page.goto('https://x.com/home',{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('[data-testid="SideNav_AccountSwitcher_Button"]').waitFor({timeout:45000}).catch(()=>{});
    const account = page.locator('[data-testid="SideNav_AccountSwitcher_Button"]');
    const identity = await account.isVisible() ? (await account.innerText()).match(/@[a-zA-Z0-9_]{1,15}\b/)?.[0] : null;
    const current = await context.cookies('https://x.com');
    await page.screenshot({path:`/app/data/${id}-session-probe.png`});
    console.log(JSON.stringify({id,proxyPort:row.proxy?.port,ip,httpStatus:response?.status(),account:identity,hasAuthBefore:cookies.some((c:{name:string})=>c.name==='auth_token'),hasAuthAfter:current.some(c=>c.name==='auth_token'),signIn:await page.getByRole('textbox',{name:/Email or username/i}).isVisible(),path:new URL(page.url()).pathname}));
  } finally {await browser.close();}
}
await db.$disconnect();
