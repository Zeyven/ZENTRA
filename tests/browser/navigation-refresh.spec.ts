import {test,expect} from './fixtures.js';
import {harness,password} from '../helpers.js';

test('刷新保留平台工作区及商家页面和标签，不保留跨页标签',async({page})=>{
 const h=await harness({closePoolsOnStop:false});
 try{
  const a=await h.onboard();
  await page.goto('/platform');
  await page.evaluate(token=>sessionStorage.setItem('za-spa-saas:platform-session:v1',token),h.platformToken);
  await page.reload();
  for(const title of ['商家管理','审计中心','运行与备份']){
   await page.getByRole('navigation',{name:'平台导航'}).getByRole('button',{name:title,exact:true}).click();
   await page.reload();await expect(page.getByRole('heading',{name:title,exact:true,level:1})).toBeVisible();
  }
  await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'报表中心',exact:true}).click();
  await page.getByRole('button',{name:'会员报表',exact:true}).click();await page.reload();
  await expect(page.locator('[data-page="reports"]')).toBeVisible();await expect(page.getByRole('button',{name:'会员报表',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'会员管理',exact:true}).click();await expect(page).not.toHaveURL(/tab=member/);
  await page.getByRole('button',{name:'异常分析',exact:true}).click();await page.reload();await expect(page.locator('[data-page="members"]')).toBeVisible();await expect(page).toHaveURL(/tab=analysis/);
 }finally{await h.stop()}
});

