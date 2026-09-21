import {test,expect} from './fixtures.js';
import {harness,password,succeeded} from '../helpers.js';
test('店长可进入并保存授权门店设置，不能管理账号权限',async({page})=>{
 const h=await harness({closePoolsOnStop:false});try{
  const a=await h.onboard(),s=a.stores[0].id;
  const user=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'manager-settings',name:'店长',password}));
  succeeded(await h.api(a.token,undefined,'/users/'+user.id+'/grants','PUT',{grants:[{store_id:s,role:'manager',pages:['settings'],actions:[]}]}));
  await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('manager-settings');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'门店设置',exact:true}).click();
  await expect(page.getByRole('button',{name:'账号权限',exact:true})).toHaveCount(0);
  const form=page.locator('.card').filter({has:page.getByRole('button',{name:'保存门店信息'})});
  await form.locator('input').nth(0).fill('店长维护门店');await form.locator('input').nth(1).fill('店长维护地址');
  const saved=page.waitForResponse(r=>r.url().endsWith('/settings')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存门店信息'}).click();expect((await(await saved).json()).ok).toBe(true);
  await page.reload();await expect(form.locator('input').nth(1)).toHaveValue('店长维护地址');
  expect(succeeded(await h.api(a.token,s,'/settings')).store_address).toBe('店长维护地址');
 }finally{await h.stop()}
});
