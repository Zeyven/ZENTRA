import {test,expect,_electron as electron} from './fixtures.js';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {platformPool,inTenant,tenantQuery} from '../../apps/server/src/db/pools.js';
import {hashPassword} from '../../apps/server/src/security.js';
test('Windows 客户端真实启动：独立身份和目录、隔离桥、禁止平台入口与任意网络',async()=>{
 const directory=resolve('.runtime','desktop-test-'+randomUUID());
 const app=await electron.launch({args:[resolve('apps/client')],env:{...process.env,NODE_ENV:'test',SAAS_TEST_USER_DATA:directory}});
 try{
  const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'登录商家工作空间'})).toBeVisible();
  await expect(page).toHaveTitle('ZA Thera｜澜序');
  await expect(page.getByRole('link',{name:'平台登录',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>Object.keys(window.saasDesktop!))).not.toContain('openPlatform');
  for(const logo of await page.getByRole('img',{name:'ZA Thera｜澜序 标志'}).all())expect(await logo.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  expect(await page.evaluate(async()=>{const link=document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;const response=await fetch(link.href);return {status:response.status,svg:(await response.text()).includes('#315E50')}})).toEqual({status:200,svg:true});
  await page.screenshot({path:'.runtime/thera-desktop-login.png'});
  const renderer=await page.evaluate(async()=>({info:await window.saasDesktop!.info(),node:typeof (window as any).require,process:typeof (window as any).process}));
  expect(renderer.info.appId).toBe('cn.zephael.zaspa.saas');expect(renderer.info.version).toBe('1.0.7');expect(renderer.info.apiOrigin).toBe('https://saas.zephael.cn');expect(renderer.node).toBe('undefined');expect(renderer.process).toBe('undefined');
  await page.getByRole('button',{name:'客户端版本',exact:true}).click();const about=page.getByRole('dialog',{name:'ZA Thera｜澜序 客户端'});await expect(about).toContainText('1.0.7');await about.getByRole('button',{name:'检查更新',exact:true}).click();await expect(about.getByRole('alert')).toContainText('开发版本不使用安装包更新通道');await about.getByRole('button',{name:'关闭ZA Thera｜澜序 客户端',exact:true}).click();
  const main=await app.evaluate(({app,BrowserWindow,Menu})=>{const win=BrowserWindow.getAllWindows()[0];return {menuRemoved:Menu.getApplicationMenu()===null,menuVisible:win.isMenuBarVisible(),name:app.name,userData:app.getPath('userData'),preferences:win.webContents.getLastWebPreferences()}});expect(main.menuRemoved).toBe(true);expect(main.menuVisible).toBe(false);expect(main.name).toBe('ZA Thera｜澜序');expect(main.userData).toBe(directory);expect(main.preferences.sandbox).toBe(true);expect(main.preferences.contextIsolation).toBe(true);expect(main.preferences.nodeIntegration).toBe(false);
  expect(await page.evaluate(async()=>{try{await fetch('https://saas.zephael.cn/api/platform/v1/auth/login',{method:'POST'});return 'allowed'}catch{return 'blocked'}})).toBe('blocked');
  expect(await page.evaluate(async()=>{try{await fetch('https://example.com/');return 'allowed'}catch{return 'blocked'}})).toBe('blocked');
  const url=page.url();await page.evaluate(()=>{location.href='zaspa-saas://app/platform'});
  // Cancelled Electron navigation leaves Playwright's navigation waiter pending;
  // verify the actual document and main-process committed URL independently.
  expect(await page.evaluate(()=>location.href)).toBe(url);expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getURL())).toBe(url);
  expect(await page.evaluate(()=>{const heading=document.querySelector('h2');return {text:heading?.textContent,visible:!!heading&&heading.getBoundingClientRect().height>0}})).toEqual({text:'登录商家工作空间',visible:true});
  const resource=await page.evaluate(async()=>{try{await fetch('zaspa-saas://app/assets/../../package.json');return 'allowed'}catch{return 'blocked'}});expect(resource).toBe('blocked');
 }finally{await app.close()}
});
test('Windows 桌面真实商家登录和收银，结账返回落库订单并显示现金交接及小票',async({request})=>{
 assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/za_spa_saas_test');
 const username='desktop-'+randomUUID(),password='Desktop-Pwd-831!',code='DESK-'+randomUUID().slice(0,8).toUpperCase();await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3)',[username,await hashPassword(password),'桌面验收管理员']);
 const login=await(await request.post('/api/platform/v1/auth/login',{data:{username,password}})).json();const created=await(await request.post('/api/platform/v1/merchants',{headers:{Authorization:'Bearer '+login.data.token},data:{code,name:'桌面验收商家'}})).json();expect(created.ok).toBe(true);
 expect((await(await request.post('/api/merchant/v1/auth/activate',{data:{token:created.data.invite.token,username:'13800138000',password,name:'桌面老板'}})).json()).ok).toBe(true);
 const signed=await(await request.post('/api/merchant/v1/auth/login',{data:{merchant_code:code,username:'13800138000',password}})).json();let storeId:number|undefined;
 async function post(path:string,data:any){const result=await(await request.post('/api/merchant/v1'+path,{headers:{Authorization:'Bearer '+signed.data.token,'Idempotency-Key':randomUUID(),...(storeId?{'X-Store-ID':String(storeId)}:{})},data})).json();expect(result.ok,JSON.stringify(result)).toBe(true);return result.data}
 const store=await post('/stores',{code:'001',name:'桌面验收店'});storeId=store.id;await post('/shifts/start',{start_cash:100});const member=await post('/members',{name:'现金充值客'});await post('/members/recharge',{customer_id:member.id,amount:50,method:'现金'});await post('/rooms',{room_no:'501'});await post('/items',{name:'桌面茶水',type:'product',price:12});
 // Serve the exact packaged renderer assets, with the real isolated API behind the preview proxy.
 const app=await electron.launch({args:[resolve('apps/client')],env:{...process.env,NODE_ENV:'test',SAAS_TEST_USER_DATA:resolve('.runtime','desktop-business-'+randomUUID()),ELECTRON_RENDERER_URL:'http://127.0.0.1:5177'}});
 try{
  const page=await app.firstWindow(),crashes:string[]=[];page.on('pageerror',e=>crashes.push(e.message));await page.getByLabel('商家编号',{exact:true}).fill(code);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'客户端版本',exact:true})).toHaveCount(0);await page.locator('.sidebar-account').getByRole('button',{name:'版本与更新',exact:true}).click();await expect(page.getByRole('button',{name:'检查更新',exact:true})).toBeVisible();await page.getByRole('button',{name:'关闭ZA Thera｜澜序 客户端',exact:true}).click();await page.getByRole('button',{name:'房间 501，空闲',exact:true}).click();const form=page.getByRole('dialog',{name:'开房',exact:true});await form.getByRole('button',{name:'确认开房',exact:true}).click();await page.getByRole('button',{name:'商品酒水',exact:true}).click();await page.getByRole('button',{name:'添加商品 桌面茶水',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'添加',exact:true}).click();await page.getByRole('button',{name:'全部使用现金收款',exact:true}).click();
  let reads=0,writes=0;page.on('request',r=>{if(r.method()==='GET'&&/\/orders\/\d+$/.test(r.url()))reads++;if(r.method()==='POST'&&r.url().endsWith('/checkout'))writes++});const response=page.waitForResponse(r=>r.url().endsWith('/checkout'));await page.getByRole('button',{name:/结\s*账（待收/}).evaluate((button:HTMLButtonElement)=>{button.click();button.click()});const result=await(await response).json();expect(result.ok,JSON.stringify(result)).toBe(true);await expect(page.getByTestId('settlement-details')).toContainText('桌面验收店');await expect(page.getByRole('button',{name:'打印小票',exact:true})).toBeVisible();expect(writes).toBe(1);expect(reads).toBe(0);
  const rows=await inTenant(created.data.merchant.id,async()=>(await tenantQuery('SELECT amount FROM payments WHERE order_id=$1',[result.data.id])).rows);expect(rows).toEqual([{amount:12}]);await page.getByRole('dialog',{name:'结账明细'}).getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'返回房态或账单'}).click();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/交接班/}).click();await expect(page.getByText('应交现金',{exact:true}).locator('..')).toContainText('162.00');expect(crashes).toEqual([]);
 }finally{await app.close()}
});


