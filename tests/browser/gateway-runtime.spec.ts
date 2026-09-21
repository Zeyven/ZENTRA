import {test,expect,_electron as electron} from './fixtures.js';
import {harness,password,succeeded} from '../helpers.js';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer,connect} from 'node:net';
import {once} from 'node:events';
import {encodeRequest,decodeAnswer,Incomplete} from '../../tools/hardware-gateway/protocol.mjs';
test('桌面签发后直接启动网关，未验证房态字段明确拒绝，刷新界面停止监听',async()=>{
 test.setTimeout(90000);const h=await harness({closePoolsOnStop:false});let app:any;
 try{
 const a=await h.onboard(),store=a.stores[0].id;await h.api(a.token,store,'/rooms','POST',{room_no:'DESK203'}).then(succeeded);
 const temp=createServer();temp.listen(0,'127.0.0.1');await once(temp,'listening');const port=(temp.address() as any).port;await new Promise<void>(r=>temp.close(()=>r()));
 app=await electron.launch({args:[resolve('apps/client')],env:{...process.env,NODE_ENV:'test',SAAS_TEST_USER_DATA:resolve('.runtime','gateway-desktop-'+randomUUID()),ELECTRON_RENDERER_URL:'http://127.0.0.1:5177'}});
 const page=await app.firstWindow();await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'门店设置',exact:true}).click();await page.getByRole('button',{name:'设备接口',exact:true}).click();
 const panel=page.getByRole('region',{name:'门店硬件网关'});await panel.getByLabel('绑定房间').selectOption({label:'DESK203'});await panel.getByLabel('面板IP').fill('127.0.0.1');await panel.getByLabel('设备编号').fill('desktop-panel');await panel.getByLabel('网关监听端口').fill(String(port));await panel.getByRole('button',{name:'生成只读网关授权'}).click();await panel.getByRole('button',{name:'在本机启动只读网关'}).click();
 const status=panel.locator('[aria-label="本机网关运行状态"]');await expect(status.getByRole('status')).toContainText('网关正在监听');
 const socket=connect(port,'127.0.0.1');try{await once(socket,'connect');const answer=await new Promise<any>((resolve,reject)=>{let buffer=Buffer.alloc(0);const timer=setTimeout(()=>reject(Error('No desktop gateway answer')),5000);socket.on('error',e=>{clearTimeout(timer);reject(e)});socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);try{const r=decodeAnswer(buffer);clearTimeout(timer);resolve(r)}catch(e){if(!(e instanceof Incomplete)){clearTimeout(timer);reject(e)}}});socket.write(encodeRequest({url:'SystemClockInfo',head:{devid:'desktop-panel',roomid:'DESK203'},body:Buffer.from('null'),sequence:1,askId:1}))});expect(answer.exstatus).toBe(1);expect(answer.exmsg).toContain('未完成实机验证')}finally{socket.destroy()}
 await panel.getByRole('button',{name:'停止本机网关'}).click();await expect(status.getByRole('status')).toContainText('已停止');await panel.getByRole('button',{name:'在本机启动只读网关'}).click();await expect(status.getByRole('status')).toContainText('网关正在监听');
 await page.getByLabel('当前门店',{exact:true}).selectOption(String(a.stores[1].id));await expect.poll(()=>page.evaluate(()=>window.saasDesktop!.gateway('state').then(s=>s.status))).toBe('stopped');
 await page.reload();await expect.poll(()=>page.evaluate(()=>window.saasDesktop!.gateway('state').then(s=>s.status))).toBe('stopped');
 }finally{if(app)await app.close();await h.stop()}
});
