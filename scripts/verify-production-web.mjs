import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const origin='https://saas.zephael.cn',account=JSON.parse(await readFile('.runtime/production-platform-account.json','utf8'));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto(origin);assert.equal(response.status(),200);await page.getByLabel('商家编号',{exact:true}).waitFor();
 await page.screenshot({path:'.runtime/production-login.png'});
 await page.goto(origin+'/platform');await page.getByLabel('平台账号',{exact:true}).fill(account.username);await page.getByLabel('密码',{exact:true}).fill(account.password);await page.getByRole('button',{name:'登录平台',exact:true}).click();
 await page.getByRole('button',{name:'开通并生成老板邀请',exact:true}).waitFor();await page.screenshot({path:'.runtime/production-platform.png'});
 assert.deepEqual(errors,[]);
 const result={origin,https_verified:true,merchant_login_rendered:true,platform_login_verified:true,page_errors:errors,checked_at:new Date().toISOString()};await writeFile('.runtime/production-web-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close()}
