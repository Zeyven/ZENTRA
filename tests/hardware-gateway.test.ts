import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {harness,succeeded,password} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
import {createHandler} from '../tools/hardware-gateway/bridge.mjs';
import {closePools} from '../apps/server/src/db/pools.js';
after(closePools);

test('hardware bridge reads actual tenant rooms and assigned services without cross-store substitution',async()=>{
 const h=await harness({closePoolsOnStop:false});try{
  const a=await h.onboard(),b=await h.onboard(),store=a.stores[0].id;
  const post=async(path:string,body:any)=>succeeded(await h.api(a.token,store,path,'POST',body));
  const room=await post('/rooms',{room_no:'HW203'}),item=await post('/items',{name:'硬件联调项目',type:'service',price:100,duration:60}),tech=await post('/technicians',{name:'测试技师',code:'HW1'});
  const config={devices:[{ip:'127.0.0.1',deviceId:'test-device',roomNo:'HW203',roomId:room.id}]};
  const request={url:'SystemClockInfo',head:{devid:'test-device',roomid:'HW203'},body:Buffer.from('null')};
  assert.equal((await h.api(a.token,undefined,'/stores/'+store,'PUT',{name:a.stores[0].name,point_clock_business_type:'MASSAGE'})).status,400);
  succeeded(await h.api(a.token,undefined,'/stores/'+store,'PUT',{name:a.stores[0].name,point_clock_business_type:'FOOT'}));
  const gatewayId=crypto.randomUUID();const grantBody={gateway_id:gatewayId,name:'硬件联调',devices:[{room_id:room.id,device_id:'test-device',device_ip:'127.0.0.1'}]};
  const duplicateRoom=await h.api(a.token,store,'/devices/gateways','POST',{gateway_id:crypto.randomUUID(),name:'重复房间',devices:[{room_id:room.id,device_id:'panel-a',device_ip:'127.0.0.2'},{room_id:room.id,device_id:'panel-b',device_ip:'127.0.0.3'}]});
  assert.equal(duplicateRoom.status,400);assert.equal(duplicateRoom.code,'DUPLICATE_ROOM_BINDING');
  const grant=succeeded(await h.api(a.token,store,'/devices/gateways','POST',grantBody));
  const duplicateAcrossGateway=await h.api(a.token,store,'/devices/gateways','POST',{gateway_id:crypto.randomUUID(),name:'跨网关重复房间',devices:[{room_id:room.id,device_id:'panel-once-more',device_ip:'127.0.0.2'}]});
  assert.equal(duplicateAcrossGateway.status,409);assert.equal(duplicateAcrossGateway.code,'ROOM_ALREADY_BOUND');
  const hardware=(path:string,method='GET',body?:unknown,token=grant.token,selectedStore=store)=>h.call('/api/hardware/v1'+path,method,body,token,selectedStore);
  const handler=createHandler(config,{get:async(path:string)=>succeeded(await hardware(path))});
  const configuredSession=succeeded(await hardware('/session'));assert.equal(configuredSession.point_clock_business_type,'FOOT');assert.equal(configuredSession.store_name,a.stores[0].name);assert.equal(configuredSession.merchant_name,a.merchant.name);
  const locked=await h.api(a.token,undefined,'/stores/'+store,'PUT',{name:a.stores[0].name,point_clock_business_type:'BATH'});assert.equal(locked.status,409);assert.equal(locked.code,'POINT_CLOCK_TYPE_IN_USE');
  assert.equal((await h.api(a.token,store,'/devices/gateways','POST',grantBody)).code,'GATEWAY_EXISTS');
  assert.equal((await hardware('/session','GET',undefined,a.token)).status,401);
  assert.equal((await h.api(grant.token,store,'/snapshot')).status,401);
  assert.equal((await hardware('/session','GET',undefined,grant.token,b.stores[0].id)).status,403);
  assert.equal((await hardware('/session?store_id='+b.stores[0].id)).status,400);
  assert.equal((await hardware('/rooms/unbound')).status,404);
  const user=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'gateway-manager',password,name:'测试店长'}));
  succeeded(await h.api(a.token,undefined,'/users/'+user.id+'/grants','PUT',{grants:[{store_id:store,role:'manager'}]}));
  const manager=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'gateway-manager',password}));
  assert.equal((await h.api(manager.token,store,'/devices/gateways','POST',{...grantBody,gateway_id:crypto.randomUUID()})).status,403);
  const list=succeeded(await h.api(a.token,store,'/devices/gateways'));assert(!JSON.stringify(list).includes(grant.token));assert(!('token_hash' in list[0]));
  const records=await inTenant(a.merchant.id,async()=>({gateway:(await tenantQuery('SELECT token_hash FROM hardware_gateways WHERE id=$1',[gatewayId])).rows[0],audit:(await tenantQuery("SELECT detail FROM audit_events WHERE action='hardware.gateway.created'")).rows}));
  assert.equal(records.gateway.token_hash.length,64);assert(!JSON.stringify(records).includes(grant.token));
  succeeded(await hardware('/heartbeat','POST',{devices:[{device_id:'test-device',state:'connected'}]}));
  assert.equal((await hardware('/heartbeat','POST',{devices:[{device_id:'foreign',state:'connected'}]})).status,400);
  assert(succeeded(await h.api(a.token,store,'/devices/gateways'))[0].last_seen_at);
  const idle=await handler(request,'127.0.0.1');assert.equal(idle.code,1);assert.deepEqual(idle.data,{status:'空闲',clock:[]});
  const unsupported=await handler({...request,url:'ReportClock'},'127.0.0.1');assert.equal(unsupported.code,0);assert.match(unsupported.msg,/尚未开放/);
  await post('/technicians/'+tech.id+'/clock',{status:'on'});const order=await post('/sessions',{resource_id:room.id});
  await post('/sessions/'+order.id+'/items',{catalog_id:item.id,technician_id:tech.id,version:order.version});
  const result=await handler(request,'127.0.0.1');assert.equal(result.code,1);assert.equal(result.data.status,'占用');assert.equal(result.data.clock.length,1);assert.equal(result.data.clock[0].t1,'HW1');assert.equal(result.data.clock[0].t3,'硬件联调项目');
  const foreign=succeeded(await h.api(b.token,b.stores[0].id,'/rooms','POST',{room_no:'HW203'}));
  assert.equal((await h.api(a.token,store,'/devices/gateways','POST',{...grantBody,gateway_id:crypto.randomUUID(),devices:[{...grantBody.devices[0],room_id:foreign.id}]})).status,403);
  await inTenant(a.merchant.id,()=>tenantQuery('UPDATE stores SET status=0 WHERE id=$1',[store]));assert.equal((await hardware('/session')).status,401);
  await inTenant(a.merchant.id,()=>tenantQuery('UPDATE stores SET status=1 WHERE id=$1',[store]));
  succeeded(await h.api(a.token,store,'/devices/gateways/'+gatewayId+'/revoke','POST',{}));
  assert.equal((await hardware('/session')).status,401);assert.equal((await hardware('/rooms/test-device')).status,401);await assert.rejects(()=>handler(request,'127.0.0.1'));

 }finally{await h.stop()}
});
