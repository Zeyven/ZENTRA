import {test,expect} from './fixtures.js';
import {harness,succeeded,password} from '../helpers.js';
import {inTenant,tenantQuery} from '../../apps/server/src/db/pools.js';
test('手牌真正删除后可重新添加，批量重复与丢失响应不会重复添加',async({page})=>{
 test.setTimeout(90000);const h=await harness({closePoolsOnStop:false});
 try{
 const a=await h.onboard(),store=a.stores[0].id;
 const band=succeeded(await h.api(a.token,store,'/wristbands','POST',{code:'001',deposit:25}));await inTenant(a.merchant.id,()=>tenantQuery('UPDATE wristbands SET active=0 WHERE id=$1',[band.id]));
 await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'门店设置',exact:true}).click();await page.getByRole('button',{name:'手牌管理',exact:true}).click();
 const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'001',exact:true})});await expect(row).toContainText('旧停用档案');
 const input=page.getByPlaceholder('每行一个手牌编码，如：1001、1002...');await input.fill('002\n001');await page.getByRole('button',{name:'添加手牌',exact:true}).click();await expect(page.getByText('手牌 001 已停用，请先删除下方旧档案，再重新添加',{exact:true})).toBeVisible();
 expect(succeeded(await h.api(a.token,store,'/wristbands')).length).toBe(0);
 await expect(page.getByRole('button',{name:'恢复手牌'})).toHaveCount(0);await row.getByRole('button',{name:'删除',exact:true}).click();await expect(row).toHaveCount(0);
 await input.fill('001\n002\n002');let dropped=false;const keys:string[]=[];
 await page.route('**/api/merchant/v1/wristbands/batch',async route=>{keys.push(route.request().headers()['idempotency-key']);if(!dropped){dropped=true;const r=await route.fetch();expect(r.ok()).toBe(true);await route.abort('failed')}else await route.continue()});
 await page.getByRole('button',{name:'添加手牌',exact:true}).click();await expect(page.getByRole('button',{name:'核对原添加结果'})).toBeVisible();await expect(input).toBeDisabled();await page.getByRole('button',{name:'核对原添加结果'}).click();await expect(input).toHaveValue('');
 expect(keys.length).toBe(2);expect(keys[0]).toBe(keys[1]);const bands=succeeded(await h.api(a.token,store,'/wristbands'));expect(bands.length).toBe(2);expect(bands.some((b:any)=>b.id===band.id)).toBe(false);expect(Number(bands.find((b:any)=>b.code==='001').deposit)).toBe(0);
 }finally{await h.stop()}
});
