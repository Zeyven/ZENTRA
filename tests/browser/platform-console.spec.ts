import {test,expect} from './fixtures.js';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {platformPool} from '../../apps/server/src/db/pools.js';
import {hashPassword} from '../../apps/server/src/security.js';
import {readFileSync} from 'node:fs';
const releaseVersion=JSON.parse(readFileSync('package.json','utf8')).version;
const username='platform-ui-'+randomUUID(),password='Platform-UI-Pwd-837!',code='PC-'+randomUUID().slice(0,8).toUpperCase();
test.beforeAll(async()=>{assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/za_spa_saas_test');await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3)',[username,await hashPassword(password),'平台运营验收'])});

test('平台六个工作区、商家维护、审计及窄屏均使用真实接口',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/platform');await page.getByLabel('平台账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录平台',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'平台导航'})).toBeVisible();await expect(page.getByRole('heading',{name:'平台总览',exact:true})).toBeVisible();
 await page.getByLabel('商家编号',{exact:true}).fill(code);await page.getByLabel('商家名称',{exact:true}).fill('平台管理验收 '+code);await page.getByRole('button',{name:'开通并生成老板邀请'}).click();await expect(page.getByLabel('老板邀请链接')).toHaveValue(/activate\?token=/);
 await page.getByRole('navigation').getByRole('button',{name:'商家管理',exact:true}).click();await page.getByLabel('搜索商家').fill(code);await page.getByRole('button',{name:'搜索',exact:true}).click();
 const row=page.getByRole('row').filter({hasText:code});await expect(row).toHaveCount(1);await row.getByRole('button',{name:'资料',exact:true}).click();
 await page.getByLabel('商家显示名称').fill('更新后的商家 '+code);await page.getByLabel('变更原因').fill('验证平台资料维护');await page.getByRole('button',{name:'保存商家资料'}).click();await expect(row).toContainText('更新后的商家');
 await row.getByRole('button',{name:'停用商家'}).click();await page.getByLabel('操作原因').fill('验收暂停');await page.getByRole('button',{name:'确认变更'}).click();await expect(row).toContainText('已停用');
 await row.getByRole('button',{name:'恢复商家'}).click();await page.getByLabel('操作原因').fill('验收恢复');await page.getByRole('button',{name:'确认变更'}).click();await expect(row).toContainText('正常服务');
 await row.getByRole('button',{name:'老板邀请'}).click();await expect(page.getByRole('dialog')).toContainText('待激活');await page.getByRole('button',{name:'补发老板邀请'}).click();await expect(page.getByLabel('补发老板邀请链接')).toHaveValue(/activate\?token=/);await page.keyboard.press('Escape');
 await page.getByRole('navigation').getByRole('button',{name:'审计中心'}).click();await page.getByLabel('搜索审计').fill('更新后的商家 '+code);await page.getByRole('button',{name:'查询',exact:true}).click();await expect(page.getByRole('row').filter({hasText:'merchant.profile.updated'})).toBeVisible();
 const auditRow=page.getByRole('row').filter({hasText:'merchant.profile.updated'});await auditRow.getByRole('button',{name:'查看详情'}).click();await expect(page.getByRole('dialog')).toContainText('验证平台资料维护');await page.keyboard.press('Escape');
 await page.getByRole('navigation').getByRole('button',{name:'支持授权'}).click();await expect(page.getByText('尚无支持授权。请商家老板在商家后台授权后再进入。')).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'运行与备份'}).click();await expect(page.getByRole('heading',{name:'应用运行'})).toBeVisible();await expect(page.getByText(releaseVersion,{exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'账号安全'}).click();await expect(page.getByText('当前会话',{exact:true})).toBeVisible();
 await page.getByLabel('当前密码',{exact:true}).fill('wrong');await page.getByLabel('新密码（8–20 位字符）').fill('Next-Password-942!');await page.getByLabel('确认新密码').fill('different');await page.getByRole('button',{name:'修改密码并重新登录'}).click();await expect(page.getByText('两次新密码不一致',{exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'平台总览'}).click();await page.setViewportSize({width:1600,height:1000});await page.screenshot({path:'.runtime/platform-console-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.runtime/platform-console-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});



