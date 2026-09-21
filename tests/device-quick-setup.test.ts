import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded} from './helpers.js';
test('一键配置原子提交、并发版本保护、幂等与商家门店隔离',async()=>{
 const h=await harness();try{
 const a=await h.onboard(),b=await h.onboard(),s=a.stores[0].id;
 const reader={kind:'wristband_reader',version:0,name:'刷牌器',model:'Keyboard reader',transport:'keyboard'};
 const speaker={kind:'technician_announcer',version:0,name:'播报器',model:'串口候选',transport:'serial',announcer_config:{protocol:'unknown',address:'COM3'}};
 const key=randomUUID(),body={devices:[reader,speaker]};const saved=succeeded(await h.api(a.token,s,'/devices/configure','POST',body,key));assert.equal(saved.devices.length,2);assert.ok(saved.devices.every((d:any)=>d.status==='not_connected'));
 assert.deepEqual(succeeded(await h.api(a.token,s,'/devices/configure','POST',body,key)),saved);
 assert.equal((await h.api(a.token,s,'/devices/configure','POST',{devices:[reader,reader]})).code,'DUPLICATE_DEVICE_KIND');
 const before=succeeded(await h.api(a.token,s,'/devices'));
 // Speaker sorts first and would be updated before the stale reader is encountered.
 const changed={devices:[{...speaker,version:before.find((d:any)=>d.kind===speaker.kind).version,model:'must roll back'},reader]};
 assert.equal((await h.api(a.token,s,'/devices/configure','POST',changed)).code,'VERSION_CONFLICT');assert.deepEqual(succeeded(await h.api(a.token,s,'/devices')),before);
 assert.deepEqual(succeeded(await h.api(a.token,a.stores[1].id,'/devices')),[]);assert.deepEqual(succeeded(await h.api(b.token,b.stores[0].id,'/devices')),[]);
 assert.equal((await h.api(b.token,s,'/devices/configure','POST',body)).status,403);
 const other=succeeded(await h.api(b.token,b.stores[0].id,'/devices/configure','POST',body,key));assert.equal(other.devices.length,2);
 }finally{await h.stop()}
});
