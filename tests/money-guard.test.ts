import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded} from './helpers.js';
// Regression suite for the "empty input silently becomes 0" money-loss class.
// Each write path asserts the HTTP status and, where the request is rejected,
// that no row was mutated (nothing landed in the database).
let h:Awaited<ReturnType<typeof harness>>,a:any;
const api=(path:string,method='GET',body?:any,key=randomUUID(),store=a.stores[0].id,token=a.token)=>h.api(token,store,path,method,body,key);
const listItems=async()=>succeeded(await api('/items'));
const listTechnicians=async()=>succeeded(await api('/technicians'));
before(async()=>{h=await harness();a=await h.onboard()});
after(()=>h.stop());

async function sessionWithService(price=100){
 const room=succeeded(await api('/rooms','POST',{room_no:'MG'+randomUUID().slice(0,6).toUpperCase()}));
 const item=succeeded(await api('/items','POST',{name:'改价服务',type:'service',price,duration:60}));
 const tech=succeeded(await api('/technicians','POST',{name:'改价技师',code:'MG'+randomUUID().slice(0,6).toUpperCase()}));
 succeeded(await api('/technicians/'+tech.id+'/clock','POST',{status:'on'}));
 let order=succeeded(await api('/sessions','POST',{resource_id:room.id}));
 order=succeeded(await api('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id,quantity:1,technician_id:tech.id}));
 return {order,item,tech,room};
}

test('items guard rejects service duration 0 and price 0 without writing anything',async()=>{
 const before=await listItems();
 const invalidDuration=await api('/items','POST',{name:'零时长服务',type:'service',price:100,duration:0});
 assert.equal(invalidDuration.status,400,JSON.stringify(invalidDuration));
 assert.equal(invalidDuration.code,'INVALID_DURATION');
 assert.equal((await listItems()).length,before.length,'被拒绝的服务项目不应落库');
 const ok=succeeded(await api('/items','POST',{name:'正常服务',type:'service',price:100,duration:60}));
 assert.equal(ok.duration,60);
 const zeroPrice=await api('/items','POST',{name:'零价商品',type:'product',price:0});
 assert.equal(zeroPrice.status,400,JSON.stringify(zeroPrice));
 assert.equal(zeroPrice.code,'VALIDATION_FAILED');
 assert((zeroPrice.details??[]).some((d:any)=>String(d.message).includes('售价必须大于 0')),JSON.stringify(zeroPrice));
 assert.equal((await listItems()).length,before.length+1,'只有正常服务应落库');
});

test('pricing override rejects a zero value and preview never zeroes the price',async()=>{
 const item=succeeded(await api('/items','POST',{name:'预览项目',type:'product',price:100}));
 const okOverride=succeeded(await api('/pricing-rules','POST',{name:'指定价八十',item_id:item.id,adjustment_type:'override',adjustment_value:80}));
 assert.equal(okOverride.adjustment_value,80);
 const preview=succeeded(await api('/pricing-rules/preview','POST',{item_id:item.id}));
 assert.notEqual(preview.final_price,0,JSON.stringify(preview));
 assert.equal(preview.final_price,80);
 // Spec (S1): routes/rules.ts must reject adjustment_value<=0 for override with
 // HTTP 400. Observed: the rule is accepted (status 200) and persisted.
 const zeroOverride=await api('/pricing-rules','POST',{name:'指定价零',item_id:item.id,adjustment_type:'override',adjustment_value:0});
 assert.equal(zeroOverride.status,400,JSON.stringify(zeroOverride));
});

test('commission rule value must be greater than zero while the >100 rate cap still applies',async()=>{
 const zero=await api('/commission-rules','POST',{name:'零提成',action_type:'rate',action_value:0});
 assert.equal(zero.status,400,JSON.stringify(zero));
 assert((zero.details??[]).some((d:any)=>String(d.message).includes('提成值必须大于 0'))||zero.message==='输入格式不正确',JSON.stringify(zero));
 const tooHigh=await api('/commission-rules','POST',{name:'超高提成',action_type:'rate',action_value:101});
 assert.equal(tooHigh.status,400,JSON.stringify(tooHigh));
});

test('settings rejects a commission tier whose rate is 0',async()=>{
 const bad=await api('/settings','POST',{commission_tiers:JSON.stringify([{min:0,rate:0}])});
 assert.equal(bad.status,400,JSON.stringify(bad));
});

test('technicians rejects an explicit zero commission_rate but still accepts an omitted one',async()=>{
 const before=await listTechnicians();
 const explicit=await api('/technicians','POST',{name:'零提成技师',code:'MG-ZERO',commission_rate:0});
 assert.equal(explicit.status,400,JSON.stringify(explicit));
 assert.equal(explicit.code,'INVALID_COMMISSION_RATE');
 assert.equal((await listTechnicians()).length,before.length,'被拒绝的技师不应落库');
 const omitted=succeeded(await api('/technicians','POST',{name:'默认提成技师',code:'MG-OMIT'}));
 assert.equal(omitted.commission_rate,0);
 assert.equal((await listTechnicians()).length,before.length+1);
});

test('session item price change rejects a zero price without changing the item',async()=>{
 const {order}=await sessionWithService();
 const itemId=order.items[0].id;
 const zero=await api('/session-items/'+itemId+'/price','POST',{version:order.version,price:0,reason:'测试零价'});
 assert.equal(zero.status,400,JSON.stringify(zero));
 assert.equal(succeeded(await api('/orders/'+order.id)).items.find((i:any)=>i.id===itemId).price,100,'被拒绝的改价不应改变项目价格');
});

test('approval gate blocks a price increase once a non-zero threshold is configured',async()=>{
 // Observed behaviour of approvals.ts approvalGate: the threshold resolves to
 // JSON.parse(settings ?? '{}')[action] ?? 0, and `threshold<=0` short-circuits to
 // null, so with the shipped default (no approval_thresholds row) the gate is inert.
 // We prove the inert default first, then configure a small non-zero discount
 // threshold and show the same increase is actually stopped.
 const baseline=await sessionWithService();
 const baselineItemId=baseline.order.items[0].id;
 const free=await api('/session-items/'+baselineItemId+'/price','POST',{version:baseline.order.version,price:150,reason:'默认阈值观察'});
 assert.equal(free.status,200,JSON.stringify(free));
 assert.equal(free.pending_approval,undefined,'默认阈值 0 时审批门不生效');
 assert.equal(succeeded(await api('/orders/'+baseline.order.id)).items.find((i:any)=>i.id===baselineItemId).price,150);
 const configured=await api('/settings','POST',{approval_thresholds:JSON.stringify({refund:0,discount:1,inventory_adjustment:0})});
 assert.equal(configured.status,200,JSON.stringify(configured));
 const {order}=await sessionWithService();
 const itemId=order.items[0].id;
 const blocked=await api('/session-items/'+itemId+'/price','POST',{version:order.version,price:150,reason:'测试涨价审批'});
 assert.equal(blocked.status,202,JSON.stringify(blocked));// 待审批写入返回 202
 assert.equal(blocked.pending_approval,true,JSON.stringify(blocked));
 assert.equal(succeeded(await api('/orders/'+order.id)).items.find((i:any)=>i.id===itemId).price,100,'审批未通过前价格不得改变');
});
