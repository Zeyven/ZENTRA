import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(async()=>{if(h)await h.stop()});
const api=(path:string,method='GET',body?:unknown,key=randomUUID(),store=a.stores[0].id)=>h.api(a.token,store,path,method,body,key);
test('times-card funding creates paid times once, never both cash balance and times, and refunds original funding',async()=>{
 const member=succeeded(await api('/members','POST',{name:'次卡会员',card_type:'times'}));const funded=succeeded(await api('/members/recharge','POST',{customer_id:member.id,amount:300,times:3,method:'支付宝'}));assert.equal(funded.member.balance,0);assert.equal(funded.member.times_balance,3);assert.equal(funded.operation.funded_amount,300);
 const typeChange=await api('/members','POST',{id:member.id,name:member.name,card_type:'storage'});assert.equal(typeChange.status,409);
 const room=succeeded(await api('/rooms','POST',{room_no:'T101'})),tech=succeeded(await api('/technicians','POST',{code:'T01',name:'次卡技师'}));succeeded(await api('/technicians/'+tech.id+'/clock','POST',{status:'on'}));const item=succeeded(await api('/items','POST',{name:'足浴',type:'service',price:100,duration:60}));
 let order=succeeded(await api('/sessions','POST',{resource_id:room.id,customer_id:member.id}));assert.equal((await api('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id,quantity:1.5})).status,400);
 order=succeeded(await api('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id,quantity:2}));order=succeeded(await api('/sessions/'+order.id+'/checkout','POST',{version:order.version,payments:[{method:'会员卡',amount:200}]}));assert.equal(order.order.member.times_balance,1);assert.equal(order.order.member.balance,0);
 assert.equal((await api('/members/'+member.id+'/reverse-recharge','POST',{recharge_id:funded.operation.id,reason:'已使用不能退款'})).status,409);
 order=succeeded(await api('/sessions/'+order.id+'/reverse-checkout','POST',{version:order.version,reason:'原单冲回'}));assert.equal(order.order.member.times_balance,3);
 succeeded(await api('/members/'+member.id+'/reverse-recharge','POST',{recharge_id:funded.operation.id,reason:'未使用购次退款'}));
 const refund=await inTenant(a.merchant.id,async()=>(await tenantQuery("SELECT amount,method FROM shift_entries WHERE kind='recharge_reversal' ORDER BY id DESC LIMIT 1")).rows[0]);assert.deepEqual(refund,{amount:-300,method:'支付宝'});
});
test('asset adjustment preserves distinct principal and bonus lots, disallows overdraw and rolls back oversized credits',async()=>{
 const member=succeeded(await api('/members','POST',{name:'权益会员'}));succeeded(await api('/members/recharge','POST',{customer_id:member.id,amount:100,gift_amount:20}));
 const key=randomUUID(),body={version:2,principal:10,bonus:-5,times:2,points:100,reason:'核对并修正权益'};
 const adjusted=succeeded(await api('/members/'+member.id+'/adjust','POST',body,key));assert.equal(adjusted.member.balance,110);assert.equal(adjusted.member.bonus_balance,15);assert.equal(adjusted.member.times_balance,2);assert.equal(adjusted.member.points,100);assert.deepEqual(succeeded(await api('/members/'+member.id+'/adjust','POST',body,key)),adjusted);
 assert.equal((await api('/members/'+member.id+'/adjust','POST',{version:3,bonus:-16,reason:'不能动用本金代扣赠金'})).status,400);
 assert.equal((await api('/members/'+member.id+'/adjust','POST',{version:3,principal:999999999999.99,reason:'超过账户总额上限'})).status,400);
 const points=succeeded(await api('/members/'+member.id+'/points-exchange','POST',{points:80,remark:'兑换门店礼品'}));assert.equal(points.points,20);assert.equal((await api('/members/'+member.id+'/points-exchange','POST',{points:21,remark:'超额兑换'})).status,400);
 const after=succeeded(await api('/members/'+member.id));assert.equal(after.balance,110);assert.equal(after.bonus_balance,15);assert.equal(after.points,20);assert.equal(after.transactions.filter((t:any)=>t.type==='adjust').length,1);
});
test('coupon ownership, thresholds, duplicate redemption and cancellation are atomic and merchant isolated',async()=>{
 const member=succeeded(await api('/members','POST',{name:'用券会员'})),other=succeeded(await api('/members','POST',{name:'其他会员'}));
 const coupon=succeeded(await api('/coupons','POST',{member_id:member.id,name:'满百减二十',value:20,min_amount:100}));const foreign=succeeded(await h.api(b.token,b.stores[0].id,'/coupons','POST',{name:'另一商家券',value:10}));
 const room=succeeded(await api('/rooms','POST',{room_no:'C101'})),item=succeeded(await api('/items','POST',{name:'礼盒',type:'product',price:100}));let order=succeeded(await api('/sessions','POST',{resource_id:room.id,customer_id:other.id}));order=succeeded(await api('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id,quantity:1}));
 assert.equal((await api('/coupons/'+coupon.id+'/use','POST',{order_id:order.id,version:order.version})).status,403);assert.equal((await api('/coupons/'+foreign.id+'/use','POST',{order_id:order.id,version:order.version})).status,404);
 order=succeeded(await api('/sessions/'+order.id+'/bind-member','POST',{version:order.version,member_id:member.id}));const key=randomUUID(),body={order_id:order.id,version:order.version};
 const results=await Promise.all([api('/coupons/'+coupon.id+'/use','POST',body,key),api('/coupons/'+coupon.id+'/use','POST',body,key)]);results.forEach(succeeded);assert.deepEqual(results[0].data,results[1].data);order=results[0].data;assert.equal(order.order.payable,80);assert.equal(order.applied_discount,20);
 assert.equal((await api('/session-items/'+order.order.items[0].id+'/price','POST',{version:order.version,price:90,reason:'低于券门槛'})).status,409);
 assert.equal((await api('/sessions/'+order.id+'/bind-member','POST',{version:order.version,member_id:other.id})).status,409);
 order=succeeded(await api('/coupons/'+coupon.id+'/cancel-use','POST',{order_id:order.id,version:order.version,reason:'顾客保留优惠券'}));assert.equal(order.order.discount,0);assert.equal(order.order.payable,100);assert.equal(succeeded(await api('/coupons?member_id='+member.id))[0].status,'unused');
});
test('member analysis, segmentation and detail use actual scoped records and execute valid SQL',async()=>{
 const analysis=succeeded(await api('/members/analysis'));assert.deepEqual(Object.keys(analysis).sort(),['abnormal_hours','high_balance_idle','high_refund','long_idle']);
 const segments=succeeded(await api('/members/segments'));assert.ok(segments.new_customer.length>0);const outsider=succeeded(await h.api(b.token,b.stores[0].id,'/members','POST',{name:'不应泄露会员'}));assert.ok(!Object.values(segments).flat().some((m:any)=>m.id===outsider.id));
});
