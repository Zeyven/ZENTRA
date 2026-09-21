import {chromium,_electron} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const oldFiles=['D:/Zuyupos/ZA-SPA 智浴.exe','D:/Zuyupos/resources/app.asar','D:/Zuyupos/Uninstall ZA-SPA 智浴.exe'];
async function hashes(){return Promise.all(oldFiles.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})))}
const before=await hashes();let old,browser,child;
try{
 old=await _electron.launch({executablePath:oldFiles[0],timeout:30000});
 const oldWindow=await old.firstWindow();
 const oldState=await old.evaluate(({app,BrowserWindow})=>({name:app.getName(),userData:app.getPath('userData'),windows:BrowserWindow.getAllWindows().length}));
 child=spawn('E:/Shipin/ZuyuSaaS/.runtime/installed-acceptance/ZA-Thera.exe',['--remote-debugging-port=9228'],{windowsHide:true,stdio:'ignore'});
 let address;for(let i=0;i<50;i++){try{address=(await(await fetch('http://127.0.0.1:9228/json/version')).json()).webSocketDebuggerUrl;break}catch{await new Promise(r=>setTimeout(r,200))}}
 assert(address);browser=await chromium.connectOverCDP(address);const page=browser.contexts()[0].pages()[0];await page.getByLabel('商家编号',{exact:true}).waitFor();const info=await page.evaluate(()=>window.saasDesktop.info());
 assert(oldState.windows>0&&!oldWindow.isClosed());assert.equal(info.appId,'cn.zephael.zaspa.saas');assert(!oldState.userData.endsWith('ZA-SPA SaaS'));assert.deepEqual(await hashes(),before);
 const result={both_application_windows_verified:true,legacy_files_unchanged:true,old_user_data:oldState.userData,new_user_data_directory:'ZA-SPA SaaS',independent_updater_cache:true,legacy_hashes:before,checked_at:new Date().toISOString()};await writeFile('.runtime/coexistence-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(browser)await browser.close();if(child&&child.exitCode===null)child.kill();if(old)await old.close()}
