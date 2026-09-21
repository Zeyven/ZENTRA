import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {io} from 'socket.io-client';
import {harness,succeeded,password} from './helpers.js';
import {inTenant,tenantQuery,platformPool} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,admin:any;
before(async()=>{h=await harness({realtime:true});a=await h.onboard();b=await h.onboard()});
after(async()=>h.stop());
test('platform enters without owner grants; identity is independent, audited and tenant scoped',async()=>{
 const path='/api/platform/v1/merchants/'+a.merchant.id+'/admin-session';
 assert.equal((await h.call(path,'POST',{},a.token)).status,401);
 admin=succeeded(await h.call(path,'POST',{},h.platformToken));
 assert.equal(admin.support.scope,'platform_admin');assert.notEqual(admin.user.id,a.user.id);
 const again=succeeded(await h.call(path,'POST',{},h.platformToken));assert.equal(again.user.id,admin.user.id);
 const grants=await inTenant(a.merchant.id,()=>tenantQuery('SELECT count(*)::integer n FROM support_grants'));assert.equal(grants.rows[0].n,0);
 const band=succeeded(await h.api(admin.token,a.stores[0].id,'/wristbands','POST',{code:'SUPERADMIN'}));
 succeeded(await h.api(admin.token,a.stores[0].id,'/wristbands/'+band.id,'DELETE'));
 const audit=await inTenant(a.merchant.id,()=>tenantQuery("SELECT * FROM audit_events WHERE action='wristbands.deleted' AND object_id=$1",[String(band.id)]));
 assert.equal(audit.rows[0].platform_user_id,h.platformUserId);assert.equal(audit.rows[0].user_id,admin.user.id);assert.equal(audit.rows[0].support_grant_id,null);
 const central=succeeded(await h.call('/api/platform/v1/activity?merchant_id='+a.merchant.id+'&search=wristbands.deleted','GET',undefined,h.platformToken));assert.equal(central.items[0].platform_user_id,h.platformUserId);assert.equal(central.items[0].detail.operation_user_id,admin.user.id);
 assert.equal((await h.api(admin.token,b.stores[0].id,'/wristbands')).status,403);
 assert.equal((await h.api(a.token,a.stores[0].id,'/users/'+admin.user.id,'PATCH',{active:0})).status,404);
 assert(!succeeded(await h.api(a.token,undefined,'/users')).some((u:any)=>u.id===admin.user.id));
 const login=await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:admin.user.username,password});assert.equal(login.status,401);
 // A merchant body field cannot turn an ordinary account into platform authority.
 assert.equal((await h.api(a.token,a.stores[0].id,'/wristbands','POST',{code:'FORGED',platform_admin:true})).status,400);
 const parts=admin.token.split('.'),payload=JSON.parse(Buffer.from(parts[1],'base64url').toString());payload.mid=b.merchant.id;parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
 assert.equal((await h.api(parts.join('.'),b.stores[0].id,'/wristbands')).status,401);
});
test('platform maintains disabled owners and suspended merchants/stores; financial approval thresholds do not restrict platform',async()=>{
 succeeded(await h.api(admin.token,undefined,'/users/'+a.user.id,'PATCH',{active:0,password:'Changed-123!'}));
 assert.equal((await h.api(a.token,a.stores[0].id,'/wristbands')).status,401);
 admin=succeeded(await h.call('/api/platform/v1/merchants/'+a.merchant.id+'/admin-session','POST',{},h.platformToken));
 succeeded(await h.api(admin.token,undefined,'/stores/'+a.stores[0].id,'PUT',{name:a.stores[0].name,status:0}));
 succeeded(await h.call('/api/platform/v1/merchants/'+a.merchant.id+'/status','PATCH',{status:'suspended',reason:'隔离维护测试'},h.platformToken));
 const member=succeeded(await h.api(admin.token,a.stores[0].id,'/members','POST',{name:'停用门店维护'}));
 const adjusted=succeeded(await h.api(admin.token,a.stores[0].id,'/members/'+member.id+'/adjust','POST',{version:1,principal:10,reason:'平台核对资产'}));assert.equal(adjusted.member.balance,10);
 const funded=succeeded(await h.api(admin.token,a.stores[0].id,'/members/recharge','POST',{customer_id:member.id,amount:20}));
 succeeded(await h.api(admin.token,a.stores[0].id,'/settings','POST',{approval_thresholds:JSON.stringify({refund:1,discount:1,inventory_adjustment:1})}));
 const refund=succeeded(await h.api(admin.token,a.stores[0].id,'/members/'+member.id+'/reverse-recharge','POST',{recharge_id:funded.operation.id,reason:'平台直接退款'}));assert.equal(refund.member.balance,10);
 const audit=await inTenant(a.merchant.id,()=>tenantQuery("SELECT platform_user_id FROM audit_events WHERE action='approval.platform_override'"));assert.equal(audit.rows[0].platform_user_id,h.platformUserId);
 const recovery=succeeded(await h.call('/api/platform/v1/merchants/'+a.merchant.id+'/recovery','GET',undefined,h.platformToken));assert(Array.isArray(recovery.archives));
 succeeded(await h.call('/api/platform/v1/merchants/'+b.merchant.id+'/recovery','GET',undefined,h.platformToken));
 assert.equal((await h.call('/api/platform/v1/merchants/'+a.merchant.id+'/recovery','GET',undefined,b.token)).status,401);
});
test('platform-created gateway and coupon authorizations work and stop when the platform account is disabled',async()=>{
 const session=succeeded(await h.call('/api/platform/v1/merchants/'+b.merchant.id+'/admin-session','POST',{},h.platformToken));
 const post=(path:string,body:any)=>h.api(session.token,b.stores[0].id,path,'POST',body);
 const room=succeeded(await post('/rooms',{room_no:'PLATFORM-HW'}));
 const gateway=succeeded(await post('/devices/gateways',{gateway_id:randomUUID(),name:'平台配置网关',devices:[{room_id:room.id,device_id:'platform-panel',device_ip:'127.0.0.1'}]}));
 succeeded(await h.call('/api/hardware/v1/session','GET',undefined,gateway.token,b.stores[0].id));
 const campaign=succeeded(await post('/coupon-campaigns',{version:0,name:'平台活动',type:'cash',value:10,min_amount:20,expire_days:10,active:true,max_claims:5}));
 const tokens=[];
 for(let i=0;i<2;i++){
  const member=succeeded(await post('/members',{name:'平台领券'+i}));const invite=succeeded(await post('/coupon-campaigns/'+campaign.id+'/invite',{member_id:member.id,verification:'in_person',reason:'核验会员'}));
  tokens.push(new URLSearchParams(new URL(invite.claim_url).hash.slice(1)).get('claim')!);
 }
 const path='/api/public/v1/'+b.merchant.code+'/'+b.stores[0].code+'/coupons/claim';
 succeeded(await h.call(path,'POST',{},tokens[0],undefined,randomUUID()));
 await platformPool.query('UPDATE platform_users SET active=false WHERE id=$1',[h.platformUserId]);
 try{
  assert.equal((await h.call('/api/hardware/v1/session','GET',undefined,gateway.token,b.stores[0].id)).status,401);
  assert.equal((await h.call(path,'POST',{},tokens[1],undefined,randomUUID())).status,403);
  assert.equal((await h.api(session.token,b.stores[0].id,'/wristbands')).status,401);
 }finally{await platformPool.query('UPDATE platform_users SET active=true WHERE id=$1',[h.platformUserId]);}
});
test('unactivated merchants can be configured without creating or impersonating their owner',async()=>{
 const created=succeeded(await h.call('/api/platform/v1/merchants','POST',{code:'U-'+randomUUID().slice(0,8),name:'未激活商家',member_mode:'store'},h.platformToken));
 const session=succeeded(await h.call('/api/platform/v1/merchants/'+created.merchant.id+'/admin-session','POST',{},h.platformToken));
 const store=succeeded(await h.api(session.token,undefined,'/stores','POST',{code:'001',name:'平台初始化'}));assert.equal(store.code,'001');
 assert.deepEqual(succeeded(await h.api(session.token,undefined,'/users')),[]);
 const activated=succeeded(await h.call('/api/merchant/v1/auth/activate','POST',{token:created.invite.token,username:'13800138000',password,name:'真实老板'}));assert(activated.user_id!==session.user.id);
});
test('platform logout revokes merchant API access and realtime access',async()=>{
 const socket=io(h.origin,{autoConnect:false,transports:['websocket'],auth:{token:admin.token,store_id:a.stores[0].id,protocol_version:1}});
 try{
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('realtime connection timeout')),10000);socket.once('session.ready',()=>{clearTimeout(timer);resolve()});socket.once('connect_error',e=>{clearTimeout(timer);reject(e)});socket.connect()});
  const disconnected=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('realtime revocation timeout')),10000);socket.once('disconnect',()=>{clearTimeout(timer);resolve()})});
  succeeded(await h.call('/api/platform/v1/auth/logout','POST',{},h.platformToken));await disconnected;
  assert.equal((await h.api(admin.token,a.stores[0].id,'/wristbands')).status,401);
  assert.equal((await h.call('/api/platform/v1/merchants/'+b.merchant.id+'/admin-session','POST',{},h.platformToken)).status,401);
 }finally{socket.disconnect()}
});
