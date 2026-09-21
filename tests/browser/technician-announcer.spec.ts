import {test,expect} from './fixtures.js';
import {harness,password} from '../helpers.js';
test('钟房播报器草稿保存、刷新回显、未接入反馈与设置入口一致',async({page})=>{
 const h=await harness({closePoolsOnStop:false});try{
 const a=await h.onboard();await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'钟房排钟',exact:true}).click();
 await page.getByRole('button',{name:'技师房播报器',exact:true}).click();const dialog=page.getByRole('dialog',{name:'技师房播报器',exact:true});
 await dialog.getByRole('button',{name:'配置技师房播报器',exact:true}).click();await dialog.getByLabel('品牌型号',{exact:true}).fill('测试播报终端');await dialog.getByLabel('设备或网关地址',{exact:true}).fill('192.168.1.50');await expect(dialog.getByLabel('通信端口',{exact:true})).toHaveCount(0);await dialog.getByRole('combobox',{name:'预期连接方式',exact:true}).selectOption('network');await dialog.getByLabel('通信端口',{exact:true}).fill('9000');await dialog.getByLabel('派钟成功',{exact:true}).check();await dialog.getByRole('button',{name:'保存播报器配置',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('尚未连接硬件');
 await page.reload();await page.getByRole('button',{name:'技师房播报器',exact:true}).click();await dialog.getByRole('button',{name:'配置技师房播报器',exact:true}).click();await expect(dialog.getByLabel('设备或网关地址',{exact:true})).toHaveValue('192.168.1.50');await expect(dialog.getByLabel('派钟成功',{exact:true})).toBeChecked();await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.getByRole('button',{name:'刷新配置诊断',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('未执行设备连接或播报测试');await expect(dialog.getByText('确认厂商通信协议',{exact:true})).toBeVisible();await expect(dialog.getByText('填写终端编号',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'门店设置',exact:true}).click();await page.getByRole('button',{name:'设备接口',exact:true}).click();await expect(page.getByRole('region',{name:'技师房播报器配置'})).toContainText('测试播报终端');
 }finally{await h.stop()}
});
