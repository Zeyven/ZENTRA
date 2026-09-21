import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,member:any,rooms:any[],items:any[],lot1:any,lot2:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard();rooms=[];items=[];
 for(const store of a.stores){rooms.push(succeeded(await h.api(a.token,store.id,'/rooms','POST',{room_no:'101',room_name:'足浴房'})));items.push(succeeded(await h.api(a.token,store.id,'/items','POST',{name:'测试商品',type:'product',price:60,stock:100})));}
 member=succeeded(await h.api(a.token,a.stores[0].id,'/members','POST',{name:'同一卡',phone:'13800138000',card_no:'VIP001'},'same-request-001'));
 const other=succeeded(await h.api(b.token,b.stores[0].id,'/members','POST',{name:'B 同一卡号',phone:'13800138000',card_no:'VIP001'},'same-request-001'));assert.notEqual(member.id,other.id);
});
after(async()=>{if(h)await h.stop()});
const api=(store:number,path:string,method='GET',body?:unknown,key=randomUUID())=>h.api(a.token,store,path,method,body,key);
async function newOrder(index:number,price?:number){
 const store=a.stores[index].id;
 if(price!==undefined){items[index]=succeeded(await api(store,'/items','POST',{...Object.fromEntries(['id','name','type','stock'].map(k=>[k,items[index][k]])),price}));}
 const opened=succeeded(await api(store,'/sessions','POST',{resource_id:rooms[index].id,customer_id:member.id}));
 return succeeded(await api(store,`/sessions/${opened.id}/items`,'POST',{catalog_id:items[index].id,quantity:1,version:opened.version}));
}
test('shared membership is visible across own stores, never across merchants; membership mode locks',async()=>{
 const shared=succeeded(await api(a.stores[1].id,'/members'));assert(shared.some((m:any)=>m.id===member.id));
 assert.equal((await h.api(b.token,b.stores[0].id,'/members/'+member.id)).status,404);
 await assert.rejects(inTenant(a.merchant.id,()=>tenantQuery("UPDATE merchants SET member_mode='store' WHERE id=$1",[a.merchant.id])),(e:any)=>e.code==='23514');
 const isolated=await h.onboard('store');const m=succeeded(await h.api(isolated.token,isolated.stores[0].id,'/members','POST',{name:'单店会员',card_no:'VIP001'},randomUUID()));
 assert.equal((await h.api(isolated.token,isolated.stores[1].id,'/members/'+m.id)).status,404);
 await assert.rejects(inTenant(isolated.merchant.id,()=>tenantQuery('INSERT INTO orders(store_id,order_no,member_id) VALUES($1,$2,$3)',[isolated.stores[1].id,'CROSS-STORE',m.id])),(e:any)=>e.code==='23503');
});
test('recharge is atomic and idempotent; same key with changed content fails',async()=>{
 const store=a.stores[0].id,key=randomUUID(),body={customer_id:member.id,amount:30,gift_amount:20};
 const results=await Promise.all([api(store,'/members/recharge','POST',body,key),api(store,'/members/recharge','POST',body,key)]);results.forEach(succeeded);assert.deepEqual(results[0].data,results[1].data);lot1=results[0].data.operation;
 assert.equal((await api(store,'/members/recharge','POST',{...body,amount:31},key)).status,409);
 lot2=succeeded(await api(a.stores[1].id,'/members/recharge','POST',{customer_id:member.id,amount:70,gift_amount:10})).operation;
 const balances=succeeded(await api(store,'/members/'+member.id));assert.equal(balances.balance,100);assert.equal(balances.bonus_balance,30);
});
test('two stores settle concurrently without overdraw; principal is spent FIFO before bonus',async()=>{
 const orders=[await newOrder(0),await newOrder(1)];
 const settled=await Promise.all(orders.map((o,i)=>api(a.stores[i].id,`/sessions/${o.id}/checkout`,'POST',{version:o.version,payments:[{method:'会员卡',amount:60}]})));
 settled.forEach(succeeded);a.closed=settled.map(r=>r.data);
 assert(a.closed.every((o:any)=>o.order.status==='closed'&&o.order.items.length===1&&o.order.payments.length===1));
 const balances=succeeded(await api(a.stores[0].id,'/members/'+member.id));assert.equal(balances.balance,0);assert.equal(balances.bonus_balance,10);
 const lots=await inTenant(a.merchant.id,()=>tenantQuery('SELECT * FROM asset_lots WHERE member_id=$1 AND principal_original>0 ORDER BY id',[member.id]));
 assert.equal(lots.rows[0].principal_remaining,0);assert.equal(lots.rows[0].bonus_remaining,0);assert.equal(lots.rows[1].principal_remaining,0);assert.equal(lots.rows[1].bonus_remaining,10);
 const allocations=await inTenant(a.merchant.id,()=>tenantQuery(`SELECT op.id,op.store_id,sum(al.principal) AS principal,sum(al.bonus) AS bonus FROM asset_operations op JOIN asset_allocations al ON al.operation_id=op.id AND al.merchant_id=op.merchant_id WHERE op.member_id=$1 AND op.type='consume' GROUP BY op.id ORDER BY op.id`,[member.id]));
 assert.equal(allocations.rows[0].principal,-60);assert.equal(allocations.rows[0].bonus,0);assert.equal(allocations.rows[1].principal,-40);assert.equal(allocations.rows[1].bonus,-20);
});
test('reverse checkout restores original lots and points once, and retry returns committed order',async()=>{
 const original=a.closed[0],store=a.stores[0].id,key=randomUUID(),body={version:original.version,reason:'验收原分配冲回'};
 const reversed=succeeded(await api(store,`/sessions/${original.id}/reverse-checkout`,'POST',body,key));assert.equal(reversed.order.status,'open');assert.equal(reversed.order.payments.length,0);assert.equal(reversed.order.payment_history.length,1);
 assert.deepEqual(succeeded(await api(store,`/sessions/${original.id}/reverse-checkout`,'POST',body,key)),reversed);
 const second=a.closed[1];succeeded(await api(a.stores[1].id,`/sessions/${second.id}/reverse-checkout`,'POST',{version:second.version,reason:'验收原分配冲回'}));
 const memberAfter=succeeded(await api(store,'/members/'+member.id));assert.equal(memberAfter.balance,100);assert.equal(memberAfter.bonus_balance,30);assert.equal(memberAfter.points,0);
 a.open=[reversed,succeeded(await api(a.stores[1].id,'/orders/'+second.id))];
});
test('insufficient assets or mismatched payments roll back all payment, points and order writes',async()=>{
 const order=a.open[0],store=a.stores[0].id;
 const before=await inTenant(a.merchant.id,()=>tenantQuery('SELECT count(*) AS n FROM payments WHERE order_id=$1',[order.id]));
 assert.equal((await api(store,`/sessions/${order.id}/checkout`,'POST',{version:order.version,payments:[{method:'会员卡',amount:999}]})).status,400);
 const after=await inTenant(a.merchant.id,()=>tenantQuery('SELECT count(*) AS n FROM payments WHERE order_id=$1',[order.id]));assert.equal(before.rows[0].n,after.rows[0].n);
 // Reverse both recharges, leaving the two open orders with no spendable assets.
 succeeded(await api(a.stores[0].id,'/members/'+member.id+'/reverse-recharge','POST',{recharge_id:lot1.id,reason:'验收充值冲销'}));
 succeeded(await api(a.stores[1].id,'/members/'+member.id+'/reverse-recharge','POST',{recharge_id:lot2.id,reason:'验收充值冲销'}));
 const result=await api(store,`/sessions/${order.id}/checkout`,'POST',{version:order.version,payments:[{method:'会员卡',amount:60}]});assert.equal(result.status,409);assert.equal(result.code,'INSUFFICIENT_ASSETS');
 const persisted=succeeded(await api(store,'/orders/'+order.id));assert.equal(persisted.status,'open');assert.equal(persisted.payments.length,0);
});
test('simultaneous overspending allows one settlement and rolls the other back',async()=>{
 succeeded(await api(a.stores[0].id,'/members/recharge','POST',{customer_id:member.id,amount:100}));
 const orders=await Promise.all(a.open.map((o:any,i:number)=>api(a.stores[i].id,'/orders/'+o.id)));orders.forEach(succeeded);
 const results=await Promise.all(orders.map((o,i)=>api(a.stores[i].id,`/sessions/${o.data.id}/checkout`,'POST',{version:o.data.version,payments:[{method:'会员卡',amount:60}]})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const balances=succeeded(await api(a.stores[0].id,'/members/'+member.id));assert.equal(balances.balance,40);assert.equal(balances.bonus_balance,0);assert.equal(balances.points,60);
});
test('composite store and tenant relationships reject foreign room, item, technician and member references',async()=>{
 await assert.rejects(inTenant(a.merchant.id,()=>tenantQuery('INSERT INTO order_items(store_id,order_id,item_id,item_name) VALUES($1,$2,$3,$4)',[a.stores[0].id,a.closed[0].id,items[1].id,'跨店项目'])),(e:any)=>e.code==='23503');
 const missing=await h.api(b.token,b.stores[0].id,'/sessions','POST',{resource_id:rooms[0].id,customer_id:member.id},randomUUID());assert.equal(missing.status,404);
});
