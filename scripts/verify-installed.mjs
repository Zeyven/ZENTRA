import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const executable=resolve('.runtime/installed-acceptance/ZA-Thera.exe');
const child=spawn(executable,['--remote-debugging-port=9228'],{windowsHide:true,stdio:'ignore'});let browser;
try{
 let address;for(let i=0;i<50;i++){try{const response=await fetch('http://127.0.0.1:9228/json/version');address=(await response.json()).webSocketDebuggerUrl;break}catch{await new Promise(r=>setTimeout(r,200))}}
 assert(address,'Installed application did not start');browser=await chromium.connectOverCDP(address);const page=browser.contexts()[0].pages()[0];await page.getByLabel('商家编号',{exact:true}).waitFor();
 const info=await page.evaluate(()=>window.saasDesktop.info());assert.equal(info.appId,'cn.zephael.zaspa.saas');assert.equal(info.apiOrigin,'https://saas.zephael.cn');assert.equal(new URL(page.url()).protocol,'zaspa-saas:');
 const update=await page.evaluate(()=>window.saasDesktop.update('check'));await page.screenshot({path:'.runtime/installed-login.png'});
 const result={installed_executable:executable,info,update,isolated_protocol:true,login_rendered:true,checked_at:new Date().toISOString()};await writeFile('.runtime/installed-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();if(child.exitCode===null)child.kill()}
