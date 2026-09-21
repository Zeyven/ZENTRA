import {test,expect} from './fixtures.js';
import type {APIRequestContext,Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {platformPool,inTenant,tenantQuery} from '../../apps/server/src/db/pools.js';
import {hashPassword} from '../../apps/server/src/security.js';

async function fixture(request:APIRequestContext){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/za_spa_saas_test');
 const username='supply-'+randomUUID(),password='Supply-Test-987!',code='STK-'+randomUUID().slice(0,8).toUpperCase();
 await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3)',[username,await hashPassword(password),'采购调拨验收管理员']);
 const platform=(await(await request.post('/api/platform/v1/auth/login',{data:{username,password}})).json()).data;
 const created=await(await request.post('/api/platform/v1/merchants',{headers:{Authorization:'Bearer '+platform.token},data:{code,name:'澜序供应链验收'}})).json();expect(created.ok).toBe(true);
 expect((await(await request.post('/api/merchant/v1/auth/activate',{data:{token:created.data.invite.token,username:'13800138000',password,name:'库存老板'}})).json()).ok).toBe(true);
 const auth=(await(await request.post('/api/merchant/v1/auth/login',{data:{merchant_code:code,username:'13800138000',password}})).json()).data;
 async function api(path:string,data?:unknown,store?:number,method='POST'){
  const result=await(await request.fetch('/api/merchant/v1'+path,{method,headers:{Authorization:'Bearer '+auth.token,'Idempotency-Key':randomUUID(),...(store?{'X-Store-ID':String(store)}:{})},data})).json();expect(result.ok,JSON.stringify(result)).toBe(true);return result.data;
 }
 const from=await api('/stores',{code:'001',name:'江畔店（验收）'}),to=await api('/stores',{code:'002',name:'山麓店（验收）'});
 const source=await api('/items',{name:'香薰耗材',type:'product',stock:10,price:10,cost:2,unit:'包'},from.id),target=await api('/items',{name:'香薰耗材',type:'product',stock:0,price:10,cost:2,unit:'包'},to.id);
 async function login(page:Page,tab:'采购收货'|'门店调拨'){
  await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(code);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await navigate(page,tab);
 }
 return {api,login,from,to,source,target,merchantId:created.data.merchant.id};
}
async function navigate(page:Page,tab:string){await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/项目商品/}).click();await page.getByRole('button',{name:tab,exact:true}).click()}

test('采购真实建单、供应商、丢响应原请求重试、两端更新和过期明细退货保护',async({page,request})=>{
 test.setTimeout(120000);const f=await fixture(request),crashes:string[]=[];page.on('pageerror',e=>crashes.push(e.message));await f.login(page,'采购收货');await page.getByRole('button',{name:'商品酒水',exact:true}).click();await page.getByRole('button',{name:'+ 新增商品',exact:true}).click();const catalogForm=page.getByRole('dialog',{name:'新增',exact:true});await expect(catalogForm.getByLabel('商品库存',{exact:true})).toHaveValue('0');await catalogForm.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'采购收货',exact:true}).click();
 const second=await page.context().newPage();try{
  await f.login(second,'采购收货');
  await page.getByRole('button',{name:'新建采购单',exact:true}).click();let form=page.getByRole('dialog',{name:'新建采购单',exact:true});
  await form.getByRole('button',{name:'新增供应商',exact:true}).click();const supplier=page.getByRole('dialog',{name:'新增供应商',exact:true});await supplier.getByLabel('供应商名称',{exact:true}).fill('澜序用品供应商');await supplier.getByLabel('联系人',{exact:true}).fill('验收联系人');await supplier.getByRole('button',{name:'保存供应商',exact:true}).click();await expect(supplier).toBeHidden();
  await form.getByLabel('商品 1',{exact:true}).selectOption(String(f.source.id));await form.getByLabel('数量 1',{exact:true}).fill('5');await form.getByLabel('单价 1',{exact:true}).fill('2.5');await form.getByLabel('单据备注',{exact:true}).fill('新店采购验收');
  let detailReads=0;page.on('request',r=>{if(r.method()==='GET'&&/\/purchase-orders\/\d+$/.test(r.url()))detailReads++});
  const saved=page.waitForResponse(r=>r.url().endsWith('/purchase-orders')&&r.request().method()==='POST');await form.getByRole('button',{name:'保存单据',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click()});const order=(await(await saved).json()).data;
  const detail=page.getByRole('dialog',{name:'采购单明细',exact:true});await expect(detail).toBeVisible();await expect(detail).toContainText('澜序用品供应商');await expect(second.getByTestId('supply-'+order.id)).toContainText('待处理');expect(detailReads).toBe(0);
  await detail.getByLabel('处理数量 香薰耗材',{exact:true}).fill('3');await detail.getByRole('button',{name:'确认收货',exact:true}).click();await expect(detail.getByRole('alert')).toContainText('请填写操作原因');
  await detail.getByLabel('单据操作原因',{exact:true}).fill('首批到货');const keys:string[]=[];let lose=true;
  await page.route('**/purchase-orders/*/receive',async route=>{
   keys.push(route.request().headers()['idempotency-key']);const response=await route.fetch();expect(response.ok()).toBe(true);
   if(lose){lose=false;await route.abort('failed')}else await route.fulfill({response});
  });
  await detail.getByRole('button',{name:'确认收货',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click()});await expect(detail.getByRole('button',{name:'核对原请求结果',exact:true})).toBeVisible();await expect(detail.getByLabel('处理数量 香薰耗材',{exact:true})).toBeDisabled();
  const replayed=page.waitForResponse(r=>r.url().endsWith('/purchase-orders/'+order.id+'/receive'));await detail.getByRole('button',{name:'核对原请求结果',exact:true}).click();expect((await(await replayed).json()).ok).toBe(true);await expect(detail.getByText('结果尚未确认，表单已保留。重试会沿用原请求编号。',{exact:true})).toBeHidden();expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect(detailReads).toBe(0);await page.unroute('**/purchase-orders/*/receive');
  await expect(second.getByTestId('supply-'+order.id)).toContainText('部分收货');
  await f.api('/purchase-orders/'+order.id+'/receive',{version:2,reason:'另一端验收',items:[{id:order.items[0].id,qty:2}]},f.from.id);await expect(second.getByTestId('supply-'+order.id)).toContainText('已收货');
  await detail.getByLabel('处理方式',{exact:true}).selectOption('return');await detail.getByLabel('处理数量 香薰耗材',{exact:true}).fill('1');await detail.getByLabel('单据操作原因',{exact:true}).fill('退货验收');await detail.getByRole('button',{name:'确认退货',exact:true}).click();await expect(detail.getByRole('alert')).toContainText('采购单已被更新');await expect(detail.getByLabel('处理数量 香薰耗材',{exact:true})).toHaveValue('1');
  await detail.getByRole('button',{name:'刷新明细',exact:true}).click();await expect(detail.getByLabel('处理数量 香薰耗材',{exact:true})).toHaveValue('0');await detail.getByLabel('处理方式',{exact:true}).selectOption('return');await detail.getByLabel('处理数量 香薰耗材',{exact:true}).fill('1');await detail.getByLabel('单据操作原因',{exact:true}).fill('退货验收');await detail.getByRole('button',{name:'确认退货',exact:true}).click();await expect(detail.getByLabel('单据操作原因',{exact:true})).toHaveValue('');
  const ledger=await inTenant(f.merchantId,async()=>(await tenantQuery("SELECT delta FROM inventory_movements WHERE source_type='purchase' AND source_id=$1 ORDER BY id",[String(order.id)])).rows);expect(ledger).toEqual([{delta:3},{delta:2},{delta:-1}]);
  await page.setViewportSize({width:1050,height:700});await expect(detail.getByRole('button',{name:'确认退货',exact:true})).toBeInViewport();await page.screenshot({path:'.runtime/thera-purchase-detail.png',fullPage:true});
  await detail.getByRole('button',{name:'关闭',exact:true}).click();await page.screenshot({path:'.runtime/thera-purchases.png',fullPage:true});expect(crashes).toEqual([]);
 }finally{await second.close()}
});

test('两店调拨真实发货收货，超库存失败保留草稿且重复点击只落一次库存',async({page,request})=>{
 test.setTimeout(120000);const f=await fixture(request),crashes:string[]=[];page.on('pageerror',e=>crashes.push(e.message));await f.login(page,'门店调拨');
 await page.getByRole('button',{name:'新建调拨单',exact:true}).click();const form=page.getByRole('dialog',{name:'新建调拨单',exact:true});await form.getByLabel('调入门店',{exact:true}).selectOption(String(f.to.id));await form.getByLabel('商品 1',{exact:true}).selectOption(String(f.source.id));await form.getByLabel('调入商品 1',{exact:true}).selectOption(String(f.target.id));await form.getByLabel('数量 1',{exact:true}).fill('3');await form.getByLabel('单据备注',{exact:true}).fill('山麓店补货');
 const saved=page.waitForResponse(r=>r.url().endsWith('/inventory-transfers')&&r.request().method()==='POST');await form.getByRole('button',{name:'保存单据',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click()});const transfer=(await(await saved).json()).data;
 const detail=page.getByRole('dialog',{name:'调拨单明细',exact:true});await expect(detail).toContainText('江畔店（验收） → 山麓店（验收）');await detail.getByRole('button',{name:'确认发货',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click()});await expect(detail).toContainText('货品在途');await detail.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByLabel('当前门店',{exact:true}).selectOption(String(f.to.id));await navigate(page,'门店调拨');await page.getByTestId('supply-'+transfer.id).getByRole('button',{name:'查看明细',exact:true}).click();await detail.getByRole('button',{name:'确认收货',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click()});await expect(detail).toContainText('已收货');await expect(detail.getByRole('button',{name:'确认收货',exact:true})).toHaveCount(0);
 const ledger=await inTenant(f.merchantId,async()=>(await tenantQuery("SELECT store_id,delta FROM inventory_movements WHERE source_type='transfer' AND source_id=$1 ORDER BY id",[String(transfer.id)])).rows);expect(ledger).toEqual([{store_id:f.from.id,delta:-3},{store_id:f.to.id,delta:3}]);
 await page.setViewportSize({width:1050,height:700});await page.screenshot({path:'.runtime/thera-transfer-detail.png',fullPage:true});await detail.getByRole('button',{name:'关闭',exact:true}).click();
 const shortage=await f.api('/inventory-transfers',{from_store_id:f.to.id,to_store_id:f.from.id,remark:'库存不足验收',items:[{item_id:f.target.id,target_item_id:f.source.id,qty:4}]},f.to.id);
 await page.getByTestId('supply-'+shortage.id).getByRole('button',{name:'查看明细',exact:true}).click();await detail.getByRole('button',{name:'确认发货',exact:true}).click();await expect(detail.getByRole('alert')).toContainText('库存不足');await expect(detail).toContainText('待处理');await detail.getByRole('button',{name:'取消调拨单',exact:true}).click();await expect(detail).toContainText('已取消');
 const counts=await inTenant(f.merchantId,async()=>(await tenantQuery('SELECT id,stock FROM items WHERE id=ANY($1::bigint[]) ORDER BY id',[[f.source.id,f.target.id]])).rows);expect(counts).toEqual([{id:f.source.id,stock:7},{id:f.target.id,stock:3}]);expect(crashes).toEqual([]);
});
