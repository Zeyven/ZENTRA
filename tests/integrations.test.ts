import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {harness,succeeded,password} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
import {visibleTopic} from '../apps/server/src/services/page-access.js';
import type {Actor} from '../apps/server/src/access.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(()=>h.stop());
test('reserved channel configuration is encrypted and scoped; no enablement, credential echo or fake redemption',async()=>{
 const secret='Test-only-channel-secret-12345678',store=a.stores[0].id;
 const saved=succeeded(await h.api(a.token,store,'/integrations/connections/meituan','PUT',{enabled:false,merchant_ref:'same-provider-ref',webhook_secret:secret}));
 assert.equal(saved.status,'not_connected');assert.equal(saved.enabled,false);assert.equal(saved.secret_configured,true);assert(!JSON.stringify(saved).includes(secret));
 const stored=await inTenant(a.merchant.id,async()=>(await tenantQuery('SELECT webhook_secret FROM channel_connections WHERE id=$1',[saved.id])).rows[0].webhook_secret);assert(stored.startsWith('aes256gcm-v1:'));assert(!stored.includes(secret));
 assert.equal(succeeded(await h.api(b.token,b.stores[0].id,'/integrations/connections')).length,0);assert.equal(succeeded(await h.api(a.token,a.stores[1].id,'/integrations/connections')).length,0);
 succeeded(await h.api(b.token,b.stores[0].id,'/integrations/connections/meituan','PUT',{enabled:false,merchant_ref:'same-provider-ref'}));
 const unchanged=succeeded(await h.api(a.token,store,'/integrations/connections/meituan','PUT',{enabled:false,merchant_ref:'updated',webhook_secret:''}));assert.equal(unchanged.secret_configured,true);
 for(const [path,method,data] of [['/integrations/connections/meituan','PUT',{enabled:true,merchant_ref:'updated'}],['/integrations/meituan/redeem','POST',{voucher_code:'123'}]] as const){const result=await h.api(a.token,store,path,method,data);assert.equal(result.status,409);assert.equal(result.code,'CHANNEL_NOT_CONNECTED')}
 assert.equal(succeeded(await h.api(a.token,store,'/integrations/orders')).length,0);
 const audit=await inTenant(a.merchant.id,()=>tenantQuery("SELECT detail FROM audit_events WHERE action='integration.configured'"));assert(!JSON.stringify(audit.rows).includes(secret));
 assert.equal((await h.api(h.platformToken,store,'/integrations/connections')).status,401);
});

test('device configuration has independent store versions and never pretends hardware commands succeeded',async()=>{
 const store=a.stores[0].id,body={version:0,name:'前台小票',model:'待选型号',transport:'system'};
 const saved=succeeded(await h.api(a.token,store,'/devices/receipt_printer','PUT',body));assert.equal(saved.version,1);assert.equal(saved.status,'not_connected');
 assert.equal((await h.api(a.token,store,'/devices/receipt_printer','PUT',body)).status,409);
 assert.equal(succeeded(await h.api(b.token,b.stores[0].id,'/devices')).length,0);assert.equal(succeeded(await h.api(a.token,a.stores[1].id,'/devices')).length,0);
 const response=await h.api(a.token,store,'/devices/receipt_printer/test','POST',{});assert.equal(response.status,409);assert.equal(response.code,'DEVICE_NOT_CONNECTED');
 const other=succeeded(await h.api(b.token,b.stores[0].id,'/devices/receipt_printer','PUT',body));assert.notEqual(other.id,saved.id);
});

test('room panel reservation persists without assuming protocol and isolates merchants and stores',async()=>{
 const store=a.stores[0].id,body={version:0,name:'房间点钟王',model:'思软 7plus（待核对）',transport:'unknown'};
 const saved=succeeded(await h.api(a.token,store,'/devices/room_panel','PUT',body));
 assert.equal(saved.status,'not_connected');assert.equal(saved.transport,'unknown');
 assert.equal(succeeded(await h.api(a.token,store,'/devices')).find((r:any)=>r.kind==='room_panel').id,saved.id);
 for(const [token,id] of [[b.token,b.stores[0].id],[a.token,a.stores[1].id]]){
  assert(!succeeded(await h.api(token,id,'/devices')).some((r:any)=>r.kind==='room_panel'));
  assert.notEqual(succeeded(await h.api(token,id,'/devices/room_panel','PUT',body)).id,saved.id);
 }
 assert.equal((await h.api(a.token,store,'/devices/room_panel','PUT',body)).code,'VERSION_CONFLICT');
 assert.equal((await h.api(a.token,store,'/devices/room_panel','PUT',{...body,version:1,merchant_id:b.merchant.id})).status,400);
 assert.equal((await h.api(a.token,b.stores[0].id,'/devices')).status,403);
 const result=await h.api(a.token,store,'/devices/room_panel/test','POST',{});
 assert.equal(result.status,409);assert.equal(result.code,'ROOM_PANEL_NOT_CONNECTED');
});

test('payment provider drafts remain disabled, validate URLs and expose real empty ledgers',async()=>{
 const store=a.stores[0].id,body={enabled:false,merchant_ref:'merchant-test',gateway_base_url:'https://gateway.example.test/api',mode:'sandbox',webhook_secret:'Payment-test-only-secret-123456'};
 const result=succeeded(await h.api(a.token,store,'/payments/providers/wechat','PUT',body));assert.equal(result.secret_configured,true);assert.equal(result.enabled,false);assert(!JSON.stringify(result).includes(body.webhook_secret));
 assert.equal((await h.api(a.token,store,'/payments/providers/wechat','PUT',{...body,enabled:true})).status,409);
 assert.equal((await h.api(a.token,store,'/payments/providers/wechat','PUT',{...body,gateway_base_url:'http://gateway.example.test'})).status,400);
 assert.equal((await h.api(a.token,store,'/payments/providers/wechat/create','POST',{})).code,'PAYMENT_NOT_CONNECTED');
 assert.equal(succeeded(await h.api(b.token,b.stores[0].id,'/payments/providers')).length,0);
 for(const path of ['orders','refunds'])assert.equal(succeeded(await h.api(a.token,store,'/payments/booking/'+path+'?status=')).length,0);
 const report=succeeded(await h.api(a.token,store,'/payments/booking/reconciliation'));assert.equal(report.payment_amount,0);assert.equal(report.refund_amount,0);assert.equal(report.net_deposit,0);assert.deepEqual(report.anomalies,[]);
});

test('technician announcer draft is scoped, versioned, validated and cannot pretend to broadcast',async()=>{
 const store=a.stores[0].id,path='/devices/technician_announcer';
 const body={version:0,name:'技师休息室播报',model:'待核对',transport:'network',announcer_config:{protocol:'unknown',address:'192.168.1.50',port:9000,terminal_id:'SP01',zone:'技师房',template:'{technician_code}号技师到{room_no}房间',repeats:2,volume:70,triggers:['manual_call','assigned']}};
 const key=crypto.randomUUID();const saved=succeeded(await h.api(a.token,store,path,'PUT',body,key));assert.equal(saved.status,'not_connected');assert.deepEqual(saved.announcer_config,body.announcer_config);
 assert.equal(succeeded(await h.api(a.token,store,path,'PUT',body,key)).version,1);
 assert.deepEqual(succeeded(await h.api(a.token,store,path)).connection.announcer_config,body.announcer_config);
 for(const [token,id] of [[b.token,b.stores[0].id],[a.token,a.stores[1].id]])assert.equal(succeeded(await h.api(token,id,path)).connection,null);
 assert.equal((await h.api(a.token,b.stores[0].id,path)).status,403);
 assert.equal((await h.api(a.token,store,path,'PUT',body)).code,'VERSION_CONFLICT');
 for(const config of [{port:65536},{repeats:0},{volume:101},{template:'{password}'},{enabled:true},{address:'http://user:secret@host/'}])assert.equal((await h.api(a.token,store,path,'PUT',{...body,version:1,announcer_config:{...body.announcer_config,...config}})).status,400);
 assert.equal((await h.api(a.token,store,path,'PUT',{...body,version:1,merchant_id:b.merchant.id})).status,400);
 const oldClient={version:1,name:body.name,model:body.model,transport:body.transport};assert.deepEqual(succeeded(await h.api(a.token,store,path,'PUT',oldClient)).announcer_config,body.announcer_config);
 const result=await h.api(a.token,store,path+'/test','POST',{});assert.equal(result.status,409);assert.equal(result.code,'ANNOUNCER_NOT_CONNECTED');
 const u=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'announcer-manager',password,name:'钟房配置店长'}));
 const grant=async(operations:string[])=>succeeded(await h.api(a.token,undefined,'/users/'+u.id+'/grants','PUT',{grants:[{store_id:store,role:'manager',pages:['clockroom'],actions:[],operations}]}));
 await grant(['settingsManage']);const token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'announcer-manager',password})).token;
 assert(succeeded(await h.api(token,store,path)).connection);assert.equal((await h.api(token,store,'/devices')).status,403);
 succeeded(await h.api(token,store,path,'PUT',{...body,version:2}));await grant([]);
 assert.equal((await h.api(token,store,path,'PUT',{...body,version:3})).code,'OPERATION_FORBIDDEN');
 assert.equal((await h.api(token,store,path+'/test','POST',{})).code,'OPERATION_FORBIDDEN');
 assert.equal(succeeded(await h.api(token,store,path)).connection.version,3);
 assert(visibleTopic('device.technician_announcer',{role:'manager',pages:['clockroom']} as Actor));
 assert(!visibleTopic('device.technician_announcer',{role:'floor',pages:['board']} as Actor));
});
