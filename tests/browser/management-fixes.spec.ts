import {test,expect} from './fixtures.js';import {randomUUID} from 'node:crypto';import {platformPool} from '../../apps/server/src/db/pools.js';import {hashPassword} from '../../apps/server/src/security.js';
const username='fix-ui-'+randomUUID(),password='Fix-Password-839!',code='FIX-'+randomUUID().slice(0,8).toUpperCase();
test.beforeAll(async()=>{await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3)',[username,await hashPassword(password),'管理修复验收'])});
test('平台矮窗口与手机可滚动到底，密码可切换，账号记忆不保存密码',async({page})=>{
 await page.setViewportSize({width:1050,height:700});await page.goto('/platform');await page.getByLabel('平台账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'显示密码',exact:true}).click();await expect(page.getByLabel('密码',{exact:true})).toHaveAttribute('type','text');await page.getByRole('button',{name:'隐藏密码'}).click();await page.getByRole('button',{name:'登录平台',exact:true}).click();await page.getByRole('navigation',{name:'平台导航'}).waitFor();
 await page.mouse.move(850,550);await page.mouse.wheel(0,3000);await expect.poll(()=>page.locator('.pc-shell').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);await expect(page.getByRole('button',{name:'开通并生成老板邀请'})).toBeInViewport();
 await page.setViewportSize({width:390,height:700});await page.locator('.pc-shell').evaluate(el=>{el.scrollTop=0});await page.mouse.move(250,500);await page.mouse.wheel(0,4000);await expect(page.getByRole('button',{name:'开通并生成老板邀请'})).toBeInViewport();
 await page.locator('.pc-shell').evaluate(el=>{el.scrollTop=0});await page.getByRole('button',{name:'退出平台'}).click();await page.reload();await expect(page.getByLabel('平台账号',{exact:true})).toHaveValue(username);await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');expect(await page.evaluate(()=>localStorage.getItem('za-spa-saas:remembered-platform-account:v1'))).not.toContain(password);
 await page.getByLabel('记住账号（不保存密码）').uncheck();await page.reload();await expect(page.getByLabel('平台账号',{exact:true})).toHaveValue('');
});
test('商家第一家门店可以停用恢复删除，账号按商家记忆，初始密码可以查看',async({page,request})=>{
 const login=(await(await request.post('/api/platform/v1/auth/login',{data:{username,password}})).json()).data;
 const created=(await(await request.post('/api/platform/v1/merchants',{headers:{Authorization:'Bearer '+login.token},data:{code,name:'管理修复商家'}})).json()).data;
 expect((await(await request.post('/api/merchant/v1/auth/activate',{data:{token:created.invite.token,username:'owner',password,name:'验收老板'}})).json()).ok).toBe(true);
 await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(code);await page.getByLabel('账号',{exact:true}).fill('owner');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'商家管理',exact:true}).click();
 await page.getByLabel('门店编号',{exact:true}).fill('FIRST');await page.getByLabel('门店名称',{exact:true}).fill('第一家空门店');await page.getByRole('button',{name:'新增门店',exact:true}).click();await expect(page.getByRole('button',{name:'停用门店',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'停用门店',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByRole('button',{name:'启用门店',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'启用门店',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByRole('button',{name:'停用门店',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'停用门店',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByRole('button',{name:'启用门店',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'删除门店',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'确定',exact:true}).click();await expect(page.getByText('空门店已删除',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'删除门店',exact:true})).toHaveCount(0);
 await page.getByLabel('初始密码',{exact:true}).fill('Employee-123!');await page.getByRole('button',{name:'显示密码',exact:true}).click();await expect(page.getByLabel('初始密码',{exact:true})).toHaveAttribute('type','text');
 await page.evaluate(()=>sessionStorage.clear());await page.reload();await expect(page.getByLabel('商家编号',{exact:true})).toHaveValue(code);await expect(page.getByLabel('账号',{exact:true})).toHaveValue('owner');await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
 await page.getByLabel('商家编号',{exact:true}).fill('ANOTHER');await expect(page.getByLabel('账号',{exact:true})).toHaveValue('');await page.getByLabel('商家编号',{exact:true}).fill(code);await expect(page.getByLabel('账号',{exact:true})).toHaveValue('owner');
 await page.getByLabel('记住商家和账号（不保存密码）').uncheck();await page.reload();await expect(page.getByLabel('商家编号',{exact:true})).toHaveValue('');await expect(page.getByLabel('账号',{exact:true})).toHaveValue('');
});

