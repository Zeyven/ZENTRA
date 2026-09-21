import {test,expect} from '@playwright/test';

test('商家登录页可切换平台并返回，密码不随页面传递，窄屏入口可见',async({page})=>{
 await page.goto('/');
 await page.getByLabel('商家编号',{exact:true}).fill('MERCHANT-ONLY');
 await page.getByLabel('账号',{exact:true}).fill('merchant-only');
 await page.getByLabel('密码',{exact:true}).fill('unsaved-password');
 await page.getByRole('navigation',{name:'登录入口'}).getByRole('link',{name:'平台登录',exact:true}).click();
 await expect(page).toHaveURL(/\/platform$/);
 await expect(page.getByLabel('平台账号',{exact:true})).toHaveValue('');
 await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
 const checkbox=page.getByLabel('记住账号（不保存密码）');
 const caption=page.locator('.pc-remember-account span');
 const inputBox=await checkbox.boundingBox(),captionBox=await caption.boundingBox();
 expect(Math.abs((inputBox!.y+inputBox!.height/2)-(captionBox!.y+captionBox!.height/2))).toBeLessThan(2);
 await caption.click();await expect(checkbox).not.toBeChecked();
 await page.reload();await expect(checkbox).not.toBeChecked();
 await page.getByRole('navigation',{name:'登录入口'}).getByRole('link',{name:'商家登录',exact:true}).click();
 await expect(page.getByRole('heading',{name:'登录商家工作空间'})).toBeVisible();
 await expect(page.getByLabel('密码',{exact:true})).toHaveValue('');
 await page.setViewportSize({width:390,height:844});
 const entry=page.getByRole('link',{name:'平台登录',exact:true});await expect(entry).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.runtime/login-switch-mobile.png',fullPage:true});
 await entry.click();await expect(page.getByLabel('平台账号',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'商家登录',exact:true})).toBeInViewport();
 await page.screenshot({path:'.runtime/platform-login-switch-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'商家登录',exact:true}).click();await expect(page.getByRole('heading',{name:'登录商家工作空间'})).toBeVisible();
});
