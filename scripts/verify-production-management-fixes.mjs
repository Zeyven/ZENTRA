import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const account=JSON.parse(await readFile('.runtime/production-platform-account.json','utf8'));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1050,height:700}}),checks=[];
 await page.goto('https://saas.zephael.cn/platform');
 await page.getByLabel('平台账号',{exact:true}).fill(account.username);
 await page.getByLabel('密码',{exact:true}).fill(account.password);
 await page.getByRole('button',{name:'显示密码',exact:true}).click();
 await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','text');
 await page.getByRole('button',{name:'隐藏密码',exact:true}).click();
 await page.getByRole('button',{name:'登录平台',exact:true}).click();
 await page.getByRole('navigation',{name:'平台导航'}).waitFor();
 for(const width of [1050,390]){
  await page.setViewportSize({width,height:700});
  for(const title of ['平台总览','商家管理','支持授权','审计中心','运行与备份','账号安全']){
   const endpoint={'平台总览':'/overview','商家管理':'/directory','支持授权':'/support-grants','审计中心':'/activity','运行与备份':'/operations','账号安全':'/sessions'}[title];
   const loaded=page.waitForResponse(r=>r.url().includes('/api/platform/v1'+endpoint)&&r.request().method()==='GET'&&r.ok());
   if(await page.getByRole('navigation',{name:'平台导航'}).getByRole('button',{name:title,exact:true}).getAttribute('aria-current')==='page') await page.getByRole('button',{name:'刷新数据',exact:true}).click(); else await page.getByRole('navigation',{name:'平台导航'}).getByRole('button',{name:title,exact:true}).click();
   await loaded;
   await page.getByRole('heading',{name:title,level:1,exact:true}).waitFor();
   await expect(page.getByRole('button',{name:'刷新数据',exact:true})).toBeEnabled();
   await page.locator('.pc-shell').evaluate(el=>{el.scrollTop=0});
   await page.mouse.move(width-8,550);await page.mouse.wheel(0,20000);
   try { await expect.poll(()=>page.locator('.pc-shell').evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop))).toBeLessThan(2); } catch(error) { console.log(JSON.stringify({width,title,details:await page.evaluate(()=>[...document.querySelectorAll('.pc-shell,.pc-main,.pc-content,.pc-footer,.pc-table-wrap')].map(el=>({class:el.className,top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight,rect:el.getBoundingClientRect().toJSON(),overflow:getComputedStyle(el).overflow})))})); await page.screenshot({path:'.runtime/scroll-diagnostic.png'}); throw error; }
   checks.push({width,page:title,...await page.locator('.pc-shell').evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop}))});
  }
 }
 await page.locator('.pc-shell').evaluate(el=>{el.scrollTop=0});
 await page.getByRole('button',{name:'退出平台',exact:true}).click();await page.reload();
 await expect(page.getByLabel('平台账号',{exact:true})).toHaveValue(account.username);
 await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
 const result={checked_at:new Date().toISOString(),version:'1.0.1',checks,password_visibility:true,account_remembered:true,password_not_remembered:true,business_mutations:0};
 await writeFile('.runtime/production-management-fixes.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}









