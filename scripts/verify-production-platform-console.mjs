import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const account=JSON.parse(await readFile('.runtime/production-platform-account.json','utf8')),origin='https://saas.zephael.cn';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const failed=[];page.on('response',r=>{if(r.url().startsWith(origin+'/api/platform/')&&r.status()>=400)failed.push({url:r.url(),status:r.status()})});
 await page.goto(origin+'/platform');await page.getByLabel('平台账号',{exact:true}).fill(account.username);await page.getByLabel('密码',{exact:true}).fill(account.password);await page.getByRole('button',{name:'登录平台',exact:true}).click();
 await page.getByRole('navigation',{name:'平台导航'}).waitFor();
 await page.getByRole('button',{name:'刷新数据',exact:true}).waitFor();await page.screenshot({path:'.runtime/production-platform-console.png',fullPage:true});
 for(const title of ['商家管理','支持授权','审计中心','运行与备份','账号安全']){
  await page.getByRole('navigation',{name:'平台导航'}).getByRole('button',{name:title,exact:true}).click();
  await page.getByRole('heading',{name:title,exact:true,level:1}).waitFor();await page.getByRole('button',{name:'刷新数据',exact:true}).waitFor();
  assert.equal(await page.getByRole('alert').count(),0,'Unexpected error in '+title);
 }
 await page.getByRole('navigation',{name:'平台导航'}).getByRole('button',{name:'平台总览',exact:true}).click();await page.getByRole('button',{name:'刷新数据',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.runtime/production-platform-console-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 await page.getByRole('button',{name:'退出平台',exact:true}).click();await page.getByRole('button',{name:'登录平台',exact:true}).waitFor();
 const result={checked_at:new Date().toISOString(),origin,workspace_count:6,login_verified:true,all_workspaces_loaded:true,api_errors:failed,page_errors:errors,mobile_overflow:false,logout_verified:true,business_mutations:0};await writeFile('.runtime/production-platform-console-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}

