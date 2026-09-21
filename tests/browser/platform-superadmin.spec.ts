import {test,expect} from './fixtures.js';
import {harness,succeeded} from '../helpers.js';
test('平台直接进入无授权商家，维护停用账号并返回后台恢复入口',async({page})=>{
 const h=await harness({closePoolsOnStop:false});try{
  const a=await h.onboard();
  succeeded(await h.call('/api/platform/v1/merchants/'+a.merchant.id+'/status','PATCH',{status:'suspended',reason:'界面验证'},h.platformToken));
  await page.addInitScript(token=>sessionStorage.setItem('za-spa-saas:platform-session:v1',token),h.platformToken);
  await page.goto('/platform');await page.getByRole('button',{name:'商家管理',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索商家',exact:true}).fill(a.merchant.code);await page.getByRole('button',{name:'搜索',exact:true}).click();
  const row=page.getByRole('row').filter({hasText:a.merchant.code});await row.getByRole('button',{name:'备份恢复',exact:true}).click();
  await expect(page.getByText('单商家备份恢复 · '+a.merchant.name,{exact:true})).toBeVisible();
  await row.getByRole('button',{name:'超级管理',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'平台超级管理 · 无需商家授权'})).toBeVisible();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'门店设置',exact:true}).click();
  await page.getByRole('button',{name:'手牌管理',exact:true}).click();await page.getByPlaceholder('每行一个手牌编码，如：1001、1002...').fill('SUPER-UI');await page.getByRole('button',{name:'添加手牌',exact:true}).click();await expect(page.getByRole('cell',{name:'SUPER-UI',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'商家管理',exact:true}).click();
  const owner=page.getByRole('row').filter({hasText:'商家老板'});await owner.getByRole('button',{name:'维护账号',exact:true}).click();
  const modal=page.getByRole('dialog');await modal.getByRole('combobox',{name:'账号状态'}).selectOption('0');await modal.getByRole('button',{name:'保存账号变更'}).click();await expect(modal).toHaveCount(0);
  await page.reload();await expect(page.getByRole('status').filter({hasText:'平台超级管理 · 无需商家授权'})).toBeVisible();
  await page.getByRole('button',{name:'返回技术后台',exact:true}).click();await expect(page.getByRole('navigation',{name:'平台导航'})).toBeVisible();
 }finally{await h.stop()}
});
