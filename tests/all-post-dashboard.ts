import "dotenv/config";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  await page.getByLabel('Dashboard password').fill(process.env.DASHBOARD_PASSWORD!);
  await page.getByRole('button',{name:'Enter workspace'}).click();
  await page.getByTestId('browser-card-browser-1').waitFor();
  const original = await page.request.get('http://localhost:3000/api/state').then(r=>r.json());
  const fixture = {...original, browserHostReady:true, profiles:original.profiles.map((p:{id:string})=>({...p,postStatus:'NONE',postError:null,postUrl:null,sessionStatus:['browser-1','browser-2','browser-3'].includes(p.id)?'VERIFIED':'NONE',sessionUsername:p.id==='browser-2'?'@fixture_two':['browser-1','browser-3'].includes(p.id)?'@fixture_one':null}))};
  await page.route('**/api/state', route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}));
  const calls: {id:string;action:string;text:string}[]=[];
  await page.route('**/api/profiles/*',async route=>{
    const body=route.request().postDataJSON();
    assert.equal(body.action,'POST_TEXT');
    const id=new URL(route.request().url()).pathname.split('/').at(-1)!;
    calls.push({id,...body});
    if(id==='browser-2') await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Account is busy'})});
    else { const p=fixture.profiles.find((p:{id:string})=>p.id===id);p.postStatus='POSTED';p.postUrl='https://x.com/fixture_one/status/123';await route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}); }
  });
  await page.reload();
  await page.getByLabel('Post to account').selectOption('all');
  await page.locator('#post-text').fill('Broadcast routing fixture');
  await page.getByRole('button',{name:'Post to all 2 accounts',exact:true}).click();
  await page.getByText('Not queued: Account is busy',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Published · View post on X ↗',exact:true}).waitFor();
  assert.deepEqual(calls,[{id:'browser-1',action:'POST_TEXT',text:'Broadcast routing fixture'},{id:'browser-2',action:'POST_TEXT',text:'Broadcast routing fixture'}]);
  console.log('PASS: select-all posts exact text once per distinct connected account, skips unconnected browsers, and shows separate success/failure results. Requests intercepted; no actual posts published.');
} finally {await browser.close();}
