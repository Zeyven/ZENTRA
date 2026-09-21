import {test,expect} from './fixtures.js';
import {harness,password,succeeded} from '../helpers.js';
import {readFile} from 'node:fs/promises';

test('老板签发并下载独立网关配置，撤销立即失效',async({page})=>{
 const h=await harness({closePoolsOnStop:false});try{
  const a=await h.onboard(),s=a.stores[0].id;
  await h.api(a.token,s,'/rooms','POST',{room_no:'GW203'}).then(succeeded);
  await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'门店设置',exact:true}).click();
  await page.getByRole('button',{name:'设备接口',exact:true}).click();
  const panel=page.getByRole('region',{name:'门店硬件网关'});
  await panel.getByLabel('绑定房间').selectOption({label:'GW203'});await panel.getByLabel('面板IP').fill('127.0.0.1');await panel.getByLabel('设备编号').fill('fixture-device');
  await panel.getByLabel('门店电脑监听IP').fill('192.168.10.254');
  await panel.getByLabel('网关监听端口').fill('18034');
  await panel.getByRole('button',{name:'添加房间面板'}).click();
  await panel.getByLabel('绑定房间').nth(1).selectOption({label:'GW203'});
  await panel.getByLabel('面板IP').nth(1).fill('127.0.0.1');
  await panel.getByLabel('设备编号').nth(1).fill('second-device');
  await panel.getByRole('button',{name:'生成只读网关授权'}).click();
  await expect(panel.getByRole('alert')).toHaveText('面板IP和设备编号不能重复');
  await panel.getByLabel('面板IP').nth(1).fill('192.168.10.33');
  await panel.getByRole('button',{name:'生成只读网关授权'}).click();
  const downloaded=page.waitForEvent('download');await panel.getByRole('button',{name:'下载网关配对文件'}).click();const file=await downloaded;
  const config=JSON.parse(await readFile((await file.path())!,'utf8'));expect(config.token).toMatch(/^gw1\./);expect(config.storeId).toBe(s);expect(config.devices[0].roomNo).toBe('GW203');
  expect(config.listenHost).toBe('192.168.10.254');expect(config.port).toBe(18034);expect(config.devices).toHaveLength(2);
  await expect(panel.getByText('房间 GW203 · 面板 second-device · IP 192.168.10.33',{exact:true})).toBeVisible();
  const reader=page.getByRole('region',{name:'刷牌器输入检测'});
  await reader.getByLabel('刷牌器检测输入').fill('000123');await reader.getByLabel('刷牌器检测输入').press('Enter');
  await expect(reader.getByRole('status')).toContainText('000123');await expect(reader.getByRole('status')).toContainText('6位');
  expect((await h.call('/api/hardware/v1/session','GET',undefined,config.token,s)).ok).toBe(true);
  await panel.getByRole('button',{name:'撤销网关授权'}).click();await expect(panel.getByText(/房间面板联调 · 授权已撤销/)).toBeVisible();await expect(panel.getByRole('button',{name:'下载网关配对文件'})).toHaveCount(0);
  expect((await h.call('/api/hardware/v1/session','GET',undefined,config.token,s)).status).toBe(401);
 }finally{await h.stop()}
});
