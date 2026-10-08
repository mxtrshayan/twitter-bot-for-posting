import "dotenv/config";
import { chromium } from "playwright";
import { db } from "../packages/database";
import { proxyOptions, hostBrowserOptions } from "../packages/browser/runtime";
const row=await db.browserProfile.findUniqueOrThrow({where:{id:"browser-1"},include:{proxy:true}});
if(!row.proxy)throw new Error("Proxy unavailable");
const browser=await chromium.launch({...hostBrowserOptions,headless:process.env.PROBE_HEADED !== "1",handleSIGTERM:false});
try {
  await Promise.all((process.env.PROBE_HEADED === "1" ? ["PROXY"] : ["PROXY","DIRECT"]).map(async mode=>{
    const context=await browser.newContext(mode==="PROXY"?{proxy:proxyOptions(row.proxy,false)}:{});
    try {
      const page=await context.newPage();let status: number|undefined;let server: string|undefined;
      page.on("response",r=>{if(r.request().isNavigationRequest()&&r.frame()===page.mainFrame()){status=r.status();server=r.headers().server;}});
      try{await page.goto("https://x.com/",{waitUntil:"domcontentloaded",timeout:30000});}catch{}
      await page.waitForTimeout(2000);
      console.log(JSON.stringify({mode,headless:process.env.PROBE_HEADED !== "1",authenticated:false,status,server,title:await page.title(),pageOrigin:new URL(page.url()).origin}));
    }finally{await context.close();}
  }));
}finally{await browser.close();await db.$disconnect();}
