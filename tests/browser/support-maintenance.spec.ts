import {test,expect} from './fixtures.js';
import {harness,succeeded} from '../helpers.js';
test('平台完整维护显示明确身份、恢复入口及商家写权限',async({page})=>{
 const h=await harness({closePoolsOnStop:false});try{
 const a=await h.onboard();succeeded(await h.api(a.token,undefined,'/support/grants','POST',{platform_user_id:h.platformUserId,scope:'maintenance',duration_minutes:30}));
 await page.addInitScript(token=>sessionStorage.setItem('za-spa-saas:platform-session:v1',token),h.platformToken);
 await page.goto('/platform');await page.getByRole('button',{name:'支持授权',exact:true}).click();
 const row=page.locator('.pc-support-row').filter({hasText:a.merchant.name});await expect(row).toContainText('完整维护');await row.getByRole('button',{name:'备份恢复'}).click();await expect(page.getByText('单商家备份恢复 · '+a.merchant.name,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'验证备份并预览'})).toBeVisible();await row.getByRole('button',{name:'进入支持会话'}).click();await expect(page.getByRole('status').filter({hasText:'完整维护（含业务资产操作）'})).toBeVisible();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'门店设置',exact:true}).click();await page.getByRole('button',{name:'手牌管理',exact:true}).click();await page.getByPlaceholder('每行一个手牌编码，如：1001、1002...').fill('MAINT001');await page.getByRole('button',{name:'添加手牌',exact:true}).click();await expect(page.getByRole('cell',{name:'MAINT001',exact:true})).toBeVisible();
 }finally{await h.stop()}
});
