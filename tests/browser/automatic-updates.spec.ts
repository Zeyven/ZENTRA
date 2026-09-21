import {test,expect} from '@playwright/test';
test('网页新版本主动提醒、忽略和刷新取消均保留当前输入',async({page})=>{
 let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++});
 await page.route('**/?update-check=1',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><script type="module" src="/assets/index-future-release.js"></script>'}));
 await page.goto('http://127.0.0.1:5177/');await page.getByLabel('商家编号',{exact:true}).fill('UNSAVED');const baseline=navigations;
 const notice=page.getByRole('status',{name:'网页更新提醒'});await expect(notice).toBeVisible();expect(navigations).toBe(baseline);
 page.once('dialog',dialog=>dialog.dismiss());await notice.getByRole('button',{name:'刷新使用新版'}).click();await expect(page.getByLabel('商家编号',{exact:true})).toHaveValue('UNSAVED');expect(navigations).toBe(baseline);
 await notice.getByRole('button',{name:'本次忽略'}).click();await expect(notice).toBeHidden();
});
test('网页与平台当前版本或离线时不误报更新',async({page})=>{
 await page.route('**/?update-check=1',route=>route.abort('internetdisconnected'));await page.goto('http://127.0.0.1:5177/platform');await expect(page.getByLabel('平台账号')).toBeVisible();await expect(page.getByRole('status',{name:'网页更新提醒'})).toHaveCount(0);
});
test('客户端更新状态主动展示且不自动下载或安装',async({page})=>{
 await page.addInitScript(()=>{let state={status:'available',version:'1.0.1'};(window as any).updateActions=[];window.saasDesktop={info:async()=>({name:'ZA Thera｜澜序',version:'1.0.1',appId:'cn.zephael.zaspa.saas',apiOrigin:location.origin,channel:'rc'}),print:async()=>({printed:true}),update:async(action:any)=>{(window as any).updateActions.push(action);if(action==='download')state={...state,status:'downloaded'};return state}} as any});
 await page.goto('/');const notice=page.getByRole('status',{name:'客户端更新提醒'});await expect(notice).toBeVisible();expect(await page.evaluate(()=>(window as any).updateActions.every((a:string)=>a==='state'))).toBe(true);
 await notice.getByRole('button',{name:'查看更新'}).click();await page.getByRole('button',{name:'下载更新',exact:true}).click();await expect(page.getByRole('button',{name:'重启并安装更新'})).toBeVisible();expect(await page.evaluate(()=>(window as any).updateActions.includes('install'))).toBe(false);
});


