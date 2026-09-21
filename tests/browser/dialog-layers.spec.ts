import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
test.beforeEach(async({page})=>{await page.goto('/@fs/'+resolve('tests/browser/dialog-layer-fixture.html').replaceAll('\\','/'))});
test('确认操作后原因输入必须在最上层并可真实点击填写',async({page})=>{
 await page.getByRole('button',{name:'落钟',exact:true}).click();await page.getByRole('button',{name:'确定',exact:true}).click();
 const reason=page.getByRole('dialog',{name:'结束服务原因'}),input=reason.getByRole('textbox');
 await input.click({timeout:3000});await input.fill('顾客服务完成');await reason.getByRole('button',{name:'确认并继续'}).click();
 await expect(page.locator('output')).toHaveText('顾客服务完成');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
test('后打开的普通弹窗不受组件声明顺序影响，Escape只关闭顶层并恢复焦点',async({page})=>{
 await page.getByRole('button',{name:'打开会员'}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();
 const input=page.getByRole('textbox',{name:'会员姓名'});await input.click({timeout:3000});await input.fill('新姓名');await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'编辑会员'})).toHaveCount(0);await expect(page.getByRole('button',{name:'编辑',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('独立布局弹窗的子表单可点击，底层弹窗不可抢占焦点',async({page})=>{
 await page.getByRole('button',{name:'打开巡房'}).click();await page.getByRole('button',{name:'登记异常'}).click();
 await page.getByLabel('会员姓名').click();await page.getByLabel('会员姓名').fill('测试嵌套输入');
 expect(await page.locator('[aria-label="巡房"]').evaluate(el=>el.closest<HTMLElement>('.dialog-backdrop')!.inert)).toBe(true);
 await page.getByRole('button',{name:'保存会员'}).click();await expect(page.getByRole('button',{name:'登记异常'})).toBeFocused();
});
test('取消原因输入解除确认按钮忙碌状态，能再次打开并提交',async({page})=>{
 await page.getByRole('button',{name:'落钟',exact:true}).click();await page.getByRole('button',{name:'确定',exact:true}).click();await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'确定',exact:true})).toBeEnabled();await page.getByRole('button',{name:'确定',exact:true}).click();await page.getByRole('textbox',{name:'结束服务原因',exact:true}).fill('重新填写');await page.getByRole('button',{name:'确认并继续'}).click();await expect(page.locator('output')).toHaveText('重新填写');
});
