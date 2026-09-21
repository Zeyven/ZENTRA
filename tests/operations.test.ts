import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,tech:any,employee:any,service:any,material:any,room:any,order:any,clock:any,requestEvent:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard();});after(async()=>{if(h)await h.stop()});
const api=(path:string,method='GET',body?:unknown,key=randomUUID(),token=a.token,store=a.stores[0].id)=>h.api(token,store,path,method,body,key);
test('configured technician can use only their own clock and start confirmation prevents premature checkout',async()=>{
 tech=succeeded(await api('/technicians','POST',{name:'技师一',code:'001'}));service=succeeded(await api('/items','POST',{name:'足浴',type:'service',price:100,duration:60}));material=succeeded(await api('/items','POST',{name:'耗材',type:'product',price:5,cost:2,stock:1}));room=succeeded(await api('/rooms','POST',{room_no:'101'}));
 succeeded(await api('/service-consumables/'+service.id,'PUT',{items:[{product_item_id:material.id,qty:2}]}));
 succeeded(await api('/technicians/'+tech.id+'/clock','POST',{status:'on'}));succeeded(await api('/clocks/settings','POST',{confirmation_mode:true}));
 employee=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'technician-one',password,name:'技师账号'}));succeeded(await h.api(a.token,undefined,'/users/'+employee.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'technician',technician_id:tech.id}]}));
 employee.token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'technician-one',password})).token;
 order=succeeded(await api('/sessions','POST',{resource_id:room.id}));order=succeeded(await api('/sessions/'+order.id+'/items','POST',{catalog_id:service.id,quantity:1,version:order.version}));clock=succeeded(await api('/clocks')).clocks[0];assert.equal(clock.state,'ASSIGNED');
 const blocked=await api('/sessions/'+order.id+'/checkout','POST',{version:order.version,payments:[{method:'现金',amount:100}]});assert.equal(blocked.status,409);assert.equal(blocked.code,'CLOCK_UNFINISHED');
 const own=succeeded(await api('/clocks','GET',undefined,undefined,employee.token));assert.equal(own.clocks.length,1);
 assert.equal((await api('/members','GET',undefined,undefined,employee.token)).status,403);
 const otherTech=succeeded(await api('/technicians','POST',{name:'技师二',code:'002'}));assert.equal((await api('/technicians/'+otherTech.id+'/clock','POST',{status:'on'},undefined,employee.token)).status,403);
});
test('ready, start, pause and resume use persisted times and optimistic versions; duplicate click does not restart the clock',async()=>{
 for(const action of ['ready','start']){const r=succeeded(await api(`/clocks/${clock.id}/${action}`,'POST',{expected_version:clock.order_version},undefined,employee.token));clock=r.clock;}
 assert.equal(clock.state,'IN_SERVICE');const started=clock.started_at;
 assert.equal((await api(`/clocks/${clock.id}/start`,'POST',{expected_version:clock.order_version},undefined,employee.token)).status,409);
 assert.equal((await api(`/clocks/${clock.id}/pause`,'POST',{expected_version:clock.order_version},undefined,employee.token)).status,400);
 const key=randomUUID(),body={expected_version:clock.order_version,reason:'顾客暂离'};
 const responses=await Promise.all([api(`/clocks/${clock.id}/pause`,'POST',body,key,employee.token),api(`/clocks/${clock.id}/pause`,'POST',body,key,employee.token)]);responses.forEach(succeeded);assert.deepEqual(responses[0].data,responses[1].data);clock=responses[0].data.clock;assert.equal(clock.state,'PAUSED');
 clock=succeeded(await api(`/clocks/${clock.id}/resume`,'POST',{expected_version:clock.order_version},undefined,employee.token)).clock;assert.equal(clock.started_at,started);assert.equal(clock.state,'IN_SERVICE');
});
test('technician requests extra time; only manager approval changes price; finish updates clock and attendance',async()=>{
 clock=succeeded(await api(`/clocks/${clock.id}/request-add-time`,'POST',{expected_version:clock.order_version,minutes:15},undefined,employee.token)).clock;
 const current=succeeded(await api('/clocks')).clocks[0];requestEvent=current.requests[0];assert.equal(requestEvent.minutes,15);
 assert.equal((await api(`/clocks/${clock.id}/add-time`,'POST',{expected_version:clock.order_version,minutes:15,amount:25,request_event_id:requestEvent.id},undefined,employee.token)).status,403);
 clock=succeeded(await api(`/clocks/${clock.id}/add-time`,'POST',{expected_version:clock.order_version,minutes:15,amount:25,request_event_id:requestEvent.id})).clock;assert.equal(clock.duration_minutes,75);
 const detail=succeeded(await api('/orders/'+order.id));assert.equal(detail.payable,125);
 clock=succeeded(await api(`/clocks/${clock.id}/finish`,'POST',{expected_version:clock.order_version,reason:'顾客提前结束'},undefined,employee.token)).clock;assert.equal(clock.state,'COMPLETED');
 const ended=succeeded(await api('/technicians/'+tech.id+'/clock','POST',{status:'off'},undefined,employee.token));assert.equal(ended.status,'off');
 const attendance=await inTenant(a.merchant.id,()=>tenantQuery('SELECT * FROM attendance WHERE technician_id=$1',[tech.id]));assert.equal(attendance.rowCount,1);assert(attendance.rows[0].clock_out_at);
});
test('material shortage rolls back settlement; restocking allows checkout and reversal restores exact quantities',async()=>{
 const before=succeeded(await api('/orders/'+order.id));const rejected=await api('/sessions/'+order.id+'/checkout','POST',{version:before.version,payments:[{method:'现金',amount:125}]});assert.equal(rejected.status,409);assert.equal(rejected.code,'INSUFFICIENT_STOCK');
 const unchanged=succeeded(await api('/orders/'+order.id));assert.equal(unchanged.status,'open');assert.equal(unchanged.payments.length,0);
 succeeded(await api('/inventory/move','POST',{item_id:material.id,type:'in',qty:3,remark:'采购入库'}));
 const settled=succeeded(await api('/sessions/'+order.id+'/checkout','POST',{version:before.version,payments:[{method:'现金',amount:125}]}));assert.equal(settled.order.status,'closed');assert.equal(succeeded(await api('/inventory/overview')).items[0].stock,2);
 const reversed=succeeded(await api('/sessions/'+order.id+'/reverse-checkout','POST',{version:settled.version,reason:'验收库存冲回'}));assert.equal(reversed.order.status,'open');assert.equal(succeeded(await api('/inventory/overview')).items[0].stock,4);
});
test('purchase receipt and return are idempotent and cannot over-receive; stocktakes reject stale counts',async()=>{
 const supplier=succeeded(await api('/suppliers','POST',{name:'供应商'}));const purchase=succeeded(await api('/purchase-orders','POST',{supplier_id:supplier.id,remark:'采购',items:[{item_id:material.id,ordered_qty:5,unit_cost:2}]}));
 const detail=succeeded(await api('/purchase-orders/'+purchase.id));const body={version:detail.version,items:[{id:detail.items[0].id,qty:3}],reason:'到货验收'},key=randomUUID();
 succeeded(await api('/purchase-orders/'+purchase.id+'/receive','POST',body,key));succeeded(await api('/purchase-orders/'+purchase.id+'/receive','POST',body,key));assert.equal(succeeded(await api('/inventory/overview')).items[0].stock,7);
 assert.equal((await api('/purchase-orders/'+purchase.id+'/receive','POST',{version:detail.version+1,items:[{id:detail.items[0].id,qty:3}],reason:'超量验收'})).status,409);
 succeeded(await api('/purchase-orders/'+purchase.id+'/receive','POST',{version:detail.version+1,mode:'return',items:[{id:detail.items[0].id,qty:1}],reason:'退货'}));assert.equal(succeeded(await api('/inventory/overview')).items[0].stock,6);
 assert.equal((await api('/inventory/count','POST',{items:[{item_id:material.id,expected_stock:7,actual_qty:5}],remark:'过期盘点'})).status,409);
 const count=succeeded(await api('/inventory/count','POST',{items:[{item_id:material.id,expected_stock:6,actual_qty:5}],remark:'实物盘点'}));assert.equal(succeeded(await api('/inventory/overview')).items[0].stock,5);
 succeeded(await api('/inventory/count/'+count.stocktake.id+'/reverse','POST',{reason:'盘点冲销验收'}));assert.equal(succeeded(await api('/inventory/overview')).items[0].stock,6);
});
test('transfer validates both stores and item ownership; dispatch and receipt each post stock once',async()=>{
 const target=succeeded(await api('/items','POST',{name:'耗材',type:'product',price:5,stock:0},undefined,a.token,a.stores[1].id));
 assert.equal((await api('/inventory-transfers','POST',{from_store_id:a.stores[0].id,to_store_id:b.stores[0].id,remark:'越权调拨',items:[{item_id:material.id,target_item_id:target.id,qty:2}]})).status,403);
 const transfer=succeeded(await api('/inventory-transfers','POST',{from_store_id:a.stores[0].id,to_store_id:a.stores[1].id,remark:'补货',items:[{item_id:material.id,target_item_id:target.id,qty:2}]}));
 succeeded(await api('/inventory-transfers/'+transfer.id+'/dispatch','POST',{}));assert.equal(succeeded(await api('/inventory/overview')).items[0].stock,4);
 const key=randomUUID();succeeded(await api('/inventory-transfers/'+transfer.id+'/receive','POST',{},key,a.token,a.stores[1].id));succeeded(await api('/inventory-transfers/'+transfer.id+'/receive','POST',{},key,a.token,a.stores[1].id));assert.equal(succeeded(await api('/inventory/overview','GET',undefined,undefined,a.token,a.stores[1].id)).items[0].stock,2);
});
