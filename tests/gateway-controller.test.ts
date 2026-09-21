import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,connect} from 'node:net';
import {once} from 'node:events';
import {harness,succeeded} from './helpers.js';
import {createGatewayController} from '../tools/hardware-gateway/controller.mjs';
import {encodeRequest,decodeAnswer,Incomplete} from '../tools/hardware-gateway/protocol.mjs';
async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=(s.address() as any).port;await new Promise<void>(r=>s.close(()=>r()));return p}
async function query(port:number,url='SystemClockInfo'){
 const socket=connect(port,'127.0.0.1');try{await once(socket,'connect');return await new Promise<any>((resolve,reject)=>{let bytes=Buffer.alloc(0);const timer=setTimeout(()=>reject(Error('No reply')),5000);socket.on('error',e=>{clearTimeout(timer);reject(e)});socket.on('data',b=>{bytes=Buffer.concat([bytes,b]);try{const answer=decodeAnswer(bytes);clearTimeout(timer);resolve(answer)}catch(e){if(!(e instanceof Incomplete)){clearTimeout(timer);reject(e)}}});socket.write(encodeRequest({url,head:{devid:'managed-panel',roomid:'M203'},body:Buffer.from('null'),sequence:1,askId:1}))})}finally{socket.destroy()}
}
test('managed desktop bridge: real cloud authorization, TCP refusal without a verified room schema, stop, restart, revocation and no token exposure',async()=>{
 const h=await harness();const controller=createGatewayController(h.origin,{allowTestLoopback:true});try{
 const a=await h.onboard(),store=a.stores[0].id,room=succeeded(await h.api(a.token,store,'/rooms','POST',{room_no:'M203'}));
 const grant=succeeded(await h.api(a.token,store,'/devices/gateways','POST',{gateway_id:crypto.randomUUID(),name:'managed',devices:[{room_id:room.id,device_id:'managed-panel',device_ip:'127.0.0.1'}]}));
 const c={apiOrigin:h.origin,listenHost:'127.0.0.1',port:await freePort(),storeId:store,token:grant.token,devices:grant.devices};
 await assert.rejects(controller.start({...c,apiOrigin:'https://example.com'}));
 await assert.rejects(controller.start({...c,devices:[{...c.devices[0],roomId:999999}]}));
 const occupied=createServer();occupied.listen(c.port,'127.0.0.1');await once(occupied,'listening');try{await assert.rejects(controller.start(c),/端口被占用/);assert.equal(occupied.listening,true)}finally{await new Promise<void>(r=>occupied.close(()=>r()))};
 const started=await controller.start(c);assert.equal(started.status,'running');assert.ok(!JSON.stringify(started).includes(grant.token));
 // 契约见 docs/HARDWARE-VERIFICATION-2026-09-18.md：日志支持的只读房态映射已实现，
 // SystemClockInfo 返回成功并映射真实房态；未开放的写操作与厂商登录仍被拒绝。
 const answer=await query(c.port);assert.equal(answer.exstatus,0);assert.equal(answer.exmsg,'成功');assert.equal(answer.data.data.status,'空闲');assert.deepEqual(answer.data.data.clock,[]);
 const write=await query(c.port,'ReportClock');assert.equal(write.exstatus,1);assert.match(write.exmsg,/尚未开放/);
 const denied=await query(c.port,'SystemDeviceLogin');assert.equal(denied.exstatus,1);
 await assert.rejects(controller.start(c),/先停止/);await controller.stop();assert.equal(controller.state().status,'stopped');
 await controller.start(c);await h.api(a.token,store,'/devices/gateways/'+grant.id+'/revoke','POST',{});assert.equal((await query(c.port)).exstatus,1);assert.equal((await controller.check()).status,'stopped');
 }finally{await controller.stop();await h.stop()}
});
