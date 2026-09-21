import {test,expect,_electron} from './fixtures.js';
import {harness,password,succeeded} from '../helpers.js';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

test('Electron 编译产物显示设备步骤并保留门店配置权限',async()=>{
 test.setTimeout(90000);const h=await harness({closePoolsOnStop:false});let app:any;
 try{
  const a=await h.onboard();
  // Preview serves the actual compiled assets and proxies the isolated API on the same origin.
  // Custom-scheme production pages intentionally prohibit plain HTTP API connections.
  app=await _electron.launch({args:[resolve('apps/client')],env:{...process.env,NODE_ENV:'test',SAAS_TEST_USER_DATA:resolve('.runtime','operations-desktop-'+randomUUID()),ELECTRON_RENDERER_URL:'http://127.0.0.1:5177'}});
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(e.message));
  await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'门店设置',exact:true}).click();await page.getByRole('button',{name:'设备接口',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'设备配置步骤'}).getByRole('button')).toHaveCount(4);
  await expect(page.getByRole('button',{name:'一键检测本机设备',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'配置手牌读卡器',exact:true}).click();const form=page.getByRole('region',{name:'设备配置表单'});
  await form.getByLabel('品牌型号').fill('键盘输入读卡器');await form.getByRole('button',{name:'保存设备配置',exact:true}).click();await expect(form).toBeHidden();
  const devices=succeeded(await h.api(a.token,a.stores[0].id,'/devices'));expect(devices.find((d:any)=>d.kind==='wristband_reader').model).toBe('键盘输入读卡器');expect(devices[0].status).toBe('not_connected');
  await page.getByRole('button',{name:'配置手牌读卡器',exact:true}).click();await form.getByLabel('品牌型号').fill('本端过期编辑');
  const reader=devices.find((d:any)=>d.kind==='wristband_reader');
  succeeded(await h.api(a.token,a.stores[0].id,'/devices/wristband_reader','PUT',{version:reader.version,name:reader.name,model:'另一终端的新配置',transport:reader.transport}));
  await form.getByRole('button',{name:'保存设备配置',exact:true}).click();await expect(form).toBeHidden();await expect(page.getByText('其他终端已修改设备配置，已重新读取。请重新打开配置并核对后保存。',{exact:true})).toBeVisible();
  expect(succeeded(await h.api(a.token,a.stores[0].id,'/devices')).find((d:any)=>d.kind==='wristband_reader').model).toBe('另一终端的新配置');
  await page.screenshot({path:'.runtime/operations-desktop-verified.png'});expect(errors).toEqual([]);
 }finally{if(app)await app.close();await h.stop()}
});
