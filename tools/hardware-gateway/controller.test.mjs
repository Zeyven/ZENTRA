import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {once} from 'node:events';
import {createGatewayController} from './controller.mjs';

// Controlled cloud responses exercise controller lifecycle only, not vendor hardware compatibility.
async function setup(options={}){
 let delayed=null,resolveSeen;const seen=new Promise(r=>resolveSeen=r);
 const switches={holdSession:false,holdHeartbeat:false,heartbeatStatus:200};
 const devices=[{device_id:'panel',device_ip:'127.0.0.1',room_id:1,room_no:'TEST1'}];
 const server=httpServer((req,res)=>{
  const status=req.url.endsWith('/heartbeat')?switches.heartbeatStatus:200;
  const reply=()=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:status===200,data:req.url.endsWith('/session')?{realm:'hardware',store_id:1,devices}:{received:true}}))};
  if((req.url.endsWith('/session')&&switches.holdSession)||(req.url.endsWith('/heartbeat')&&switches.holdHeartbeat)){delayed=reply;resolveSeen()}else reply();
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 const listener=tcpServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const config={apiOrigin:origin,listenHost:'127.0.0.1',port,storeId:1,token:'gw1.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.'+'a'.repeat(43),devices:[{deviceId:'panel',ip:'127.0.0.1',roomId:1,roomNo:'TEST1'}]};
 const controller=createGatewayController(origin,{allowTestLoopback:true,...options});
 return {switches,config,controller,seen,release:()=>{const reply=delayed;delayed=null;reply?.()},close:async()=>{const reply=delayed;delayed=null;reply?.();await controller.stop();server.closeAllConnections();await new Promise(r=>server.close(r))}};
}
test('停止授权验证立即取消挂起请求，不等待云端响应或五秒超时',{timeout:2000},async()=>{
 const s=await setup();try{
  s.switches.holdSession=true;const started=s.controller.start(s.config);await s.seen;assert.equal(s.controller.state().status,'starting');await s.controller.stop();assert.equal((await started).status,'stopped');s.release();
  const probe=tcpServer();probe.listen(s.config.port,'127.0.0.1');await once(probe,'listening');await new Promise(r=>probe.close(r));
  s.switches.holdSession=false;assert.equal((await s.controller.start(s.config)).status,'running');
 }finally{await s.close()}
});
test('断网只标记降级，恢复后重新验证；失效授权关闭监听并清除状态中的设备',async()=>{
 const s=await setup();try{
  await s.controller.start(s.config);s.switches.heartbeatStatus=503;assert.equal((await s.controller.check()).status,'degraded');s.switches.heartbeatStatus=200;assert.equal((await s.controller.check()).status,'running');
  s.switches.heartbeatStatus=401;const ended=await s.controller.check();assert.equal(ended.status,'stopped');assert.deepEqual(ended.devices,[]);assert.ok(!JSON.stringify(ended).includes(s.config.token));
 }finally{await s.close()}
});
test('发布模式不接受 HTTP 源、带路径源或替换云端地址',async()=>{
 assert.throws(()=>createGatewayController('http://127.0.0.1:8792'));
 assert.throws(()=>createGatewayController('https://example.com/path'));
 const s=await setup();try{await assert.rejects(s.controller.start({...s.config,apiOrigin:'https://example.com'}));assert.equal(s.controller.state().status,'stopped')}finally{await s.close()}
});

test('停止取消旧心跳，重启后旧授权失败不能停掉新网关',{timeout:2000},async()=>{
 const s=await setup();try{
  await s.controller.start(s.config);
  s.switches.holdHeartbeat=true;s.switches.heartbeatStatus=401;
  const oldCheck=s.controller.check();await s.seen;
  await s.controller.stop();assert.equal((await oldCheck).status,'stopped');
  s.switches.holdHeartbeat=false;s.switches.heartbeatStatus=200;
  assert.equal((await s.controller.start(s.config)).status,'running');
  s.release();assert.equal((await s.controller.check()).status,'running');
  assert.equal(s.controller.state().storeId,s.config.storeId);
 }finally{await s.close()}
});

test('读取原厂缓存期间停止后，迟到结果不得重新创建监听或残留运行实例',async()=>{
 let entered,release;
 const seen=new Promise(resolve=>{entered=resolve});
 const pending=new Promise(resolve=>{release=resolve});
 let first=true;
 const s=await setup({loadVendor:async()=>{if(first){first=false;entered();return pending}return {vendor:null,message:''}}});
 try{
  const started=s.controller.start(s.config);await seen;
  await s.controller.stop();release({vendor:null,message:''});
  assert.equal((await started).status,'stopped');
  assert.deepEqual(s.controller.state().devices,[]);
  assert.equal((await s.controller.start(s.config)).status,'running');
 }finally{release({vendor:null,message:''});await s.close()}
});
