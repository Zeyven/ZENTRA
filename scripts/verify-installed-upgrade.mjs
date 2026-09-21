import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {extractFile} from '@electron/asar';
import {openSync,closeSync} from 'node:fs';
import assert from 'node:assert/strict';
// QA process only: a measured local system-proxy slowdown must not mask installer behavior.
// Production network settings and TLS verification are unchanged.
const executable=resolve('.runtime/installed-acceptance/ZA-Thera.exe'),log=openSync('.runtime/installed-upgrade.log','a'),child=spawn(executable,['--remote-debugging-port=9228','--no-proxy-server'],{windowsHide:true,stdio:['ignore',log,log]});closeSync(log);let browser,installRequested=false;
try{
 let address;for(let i=0;i<50;i++){try{address=(await(await fetch('http://127.0.0.1:9228/json/version')).json()).webSocketDebuggerUrl;break}catch{await new Promise(r=>setTimeout(r,200))}}
 assert(address);browser=await chromium.connectOverCDP(address);const page=browser.contexts()[0].pages()[0];await page.getByLabel('商家编号',{exact:true}).waitFor();
 const info=await page.evaluate(()=>window.saasDesktop.info());assert.equal(info.version,'1.0.0-rc.0');
 const available=await page.evaluate(()=>window.saasDesktop.update('check'));assert.equal(available.status,'available');assert.equal(available.version,'1.0.0-rc.1');
 console.log('Verified older installed client discovers the independent rc.1 update.');
 const downloaded=await page.evaluate(()=>window.saasDesktop.update('download'));assert.equal(downloaded.status,'downloaded');installRequested=true;
 try{await page.evaluate(()=>window.saasDesktop.update('install'))}catch(error){assert.match(error.message,/closed|destroyed/)}
 await new Promise((resolve,reject)=>{const installer=spawn('pwsh.exe',['-NoProfile','-File','scripts/finish-upgrade-acceptance.ps1'],{windowsHide:true,stdio:'inherit'});installer.on('error',reject);installer.on('exit',code=>code===0?resolve():reject(Error('NSIS acceptance failed')))});
 let version;for(let i=0;i<240;i++){try{version=JSON.parse(extractFile(resolve('.runtime/installed-acceptance/resources/app.asar'),'package.json').toString()).version;if(version==='1.0.0-rc.1')break}catch{}await new Promise(r=>setTimeout(r,500))}
 assert.equal(version,'1.0.0-rc.1','Installer did not replace the older version');
 const result={from:info.version,to:version,download_verified_by_updater:true,updater_installer_handoff_verified:true,installer_upgrade_verified:true,installer_interaction:'NSIS supported silent mode for QA',network:'direct QA process; product proxy settings unchanged',checked_at:new Date().toISOString()};await writeFile('.runtime/installed-upgrade.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(browser)await browser.close().catch(()=>{});if(!installRequested&&child.exitCode===null)child.kill()}
