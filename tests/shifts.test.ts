import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,first:any,closed:any,second:any,order:any,recharge:any,member:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(async()=>{if(h)await h.stop()});
const api=(path:string,method='GET',body?:unknown,key=randomUUID(),store=a.stores[0].id)=>h.api(a.token,store,path,method,body,key);
test('one shared open shift per store; same identifiers and parallel starts remain tenant isolated',async()=>{
 const attempts=await Promise.all([api('/shifts/start','POST',{start_cash:100}),api('/shifts/start','POST',{start_cash:100})]);assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);first=attempts.find(r=>r.status===200).data;
 const other=succeeded(await h.api(b.token,b.stores[0].id,'/shifts/start','POST',{start_cash:10},randomUUID()));assert.notEqual(first.id,other.id);
 assert.equal(succeeded(await api('/shifts?current=1')).id,first.id);
});
test('checkout, recharge and deposit reconcile by their real funding methods',async()=>{
 const room=succeeded(await api('/rooms','POST',{room_no:'101'})),item=succeeded(await api('/items','POST',{name:'测试商品',type:'product',price:100,stock:5}));member=succeeded(await api('/members','POST',{name:'储值会员'}));
 recharge=succeeded(await api('/members/recharge','POST',{customer_id:member.id,amount:200,gift_amount:20,method:'微信'}));
 order=succeeded(await api('/sessions','POST',{resource_id:room.id,deposit:30}));order=succeeded(await api('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id,quantity:1}));
 order=succeeded(await api('/sessions/'+order.id+'/checkout','POST',{version:order.version,payments:[{method:'现金',amount:60},{method:'支付宝',amount:40}]}));
 const current=succeeded(await api('/shifts?current=1'));assert.equal(current.total_sales,100);assert.equal(current.total_cash,60);assert.equal(current.total_alipay,40);assert.equal(current.total_wechat,0);assert.equal(current.total_recharge,200);assert.equal(current.deposit_net,30);assert.equal(current.expected_cash,190);assert.equal(current.net_external['微信'],200);
 const key=randomUUID();closed=succeeded(await api('/shifts/end','POST',{note:'第一班核对完成'},key));const replay=succeeded(await api('/shifts/end','POST',{note:'第一班核对完成'},key));assert.deepEqual(replay,closed);assert.equal(closed.status,'closed');assert.equal(succeeded(await api('/shifts?current=1')),null);
});
test('later reversals and deposit refunds belong to the current shift and leave closed snapshots unchanged',async()=>{
 second=succeeded(await api('/shifts/start','POST',{start_cash:500}));
 order=succeeded(await api('/sessions/'+order.id+'/refund-deposit','POST',{version:order.version,reason:'退还押金'}));
 order=succeeded(await api('/sessions/'+order.id+'/reverse-checkout','POST',{version:order.version,reason:'跨班核对冲销'}));
 succeeded(await api('/members/'+member.id+'/reverse-recharge','POST',{recharge_id:recharge.operation.id,reason:'退还未用储值'}));
 const summary=succeeded(await api('/shifts?current=1'));assert.equal(summary.total_cash,-60);assert.equal(summary.total_alipay,-40);assert.equal(summary.total_refund,100);assert.equal(summary.total_recharge,-200);assert.equal(summary.deposit_net,-30);assert.equal(summary.expected_cash,410);
 const historical=succeeded(await api('/shifts')).find((s:any)=>s.id===first.id);for(const key of ['total_sales','total_cash','total_alipay','total_recharge','expected_cash','end_at'])assert.equal(historical[key],closed[key]);
 assert.equal((await api('/members/'+member.id+'/reverse-recharge','POST',{recharge_id:recharge.operation.id,reason:'重复退款'})).status,409);
 const counts=await inTenant(a.merchant.id,async()=>(await tenantQuery("SELECT count(*)::integer AS n FROM shift_entries WHERE kind='recharge_reversal'")).rows[0]);assert.equal(counts.n,1);
});
test('closing a shift races safely with checkout; every receipt has exactly one immutable allocation',async()=>{
 const room=succeeded(await api('/rooms','POST',{room_no:'102'})),item=succeeded(await api('/items','POST',{name:'并发商品',type:'product',price:15}));let next=succeeded(await api('/sessions','POST',{resource_id:room.id}));next=succeeded(await api('/sessions/'+next.id+'/items','POST',{version:next.version,catalog_id:item.id,quantity:1}));
 const results=await Promise.all([api('/shifts/end','POST',{note:'并发交班'}),api('/sessions/'+next.id+'/checkout','POST',{version:next.version,payments:[{method:'现金',amount:15}]})]);results.forEach(succeeded);
 const entry=await inTenant(a.merchant.id,async()=>(await tenantQuery("SELECT shift_id,amount FROM shift_entries WHERE order_id=$1 AND kind='payment'",[next.id])).rows);assert.equal(entry.length,1);assert.equal(entry[0].amount,15);
 const ended=succeeded(results[0]);assert.equal(ended.total_cash,entry[0].shift_id===second.id?-45:-60);
});
