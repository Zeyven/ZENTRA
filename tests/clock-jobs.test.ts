import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {harness,succeeded} from './helpers.js';
import {inTenant,tenantQuery,runtimePool} from '../apps/server/src/db/pools.js';
import {scanMerchantClocks} from '../apps/server/src/jobs.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,clockA:any,clockB:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard();async function start(t:any){const api=(p:string,body:any)=>h.api(t.token,t.stores[0].id,p,'POST',body);const tech=succeeded(await api('/technicians',{name:'任务技师',code:'JOB'}));succeeded(await api('/technicians/'+tech.id+'/clock',{status:'on'}));const room=succeeded(await api('/rooms',{room_no:'JOB'})),item=succeeded(await api('/items',{name:'任务钟单',type:'service',price:100,duration:1}));let order=succeeded(await api('/sessions',{resource_id:room.id}));order=succeeded(await api('/sessions/'+order.id+'/items',{catalog_id:item.id,technician_id:tech.id,version:order.version}));return order.order.items[0]}clockA=await start(a);clockB=await start(b)});after(()=>h.stop());
test('background scans bind a merchant, deduplicate concurrent scans, respect suspension and clear pooled tenant context',async()=>{
 const attempts=await Promise.all([scanMerchantClocks(a.merchant.id),scanMerchantClocks(a.merchant.id)]);assert.equal(attempts.reduce((sum,n)=>sum+n,0),1);
 const own=await inTenant(a.merchant.id,async()=>(await tenantQuery('SELECT order_item_id,kind FROM clock_reminders')).rows);assert.deepEqual(own,[{order_item_id:clockA.id,kind:'before_5'}]);
 const other=await inTenant(b.merchant.id,async()=>(await tenantQuery('SELECT id FROM clock_reminders')).rows);assert.deepEqual(other,[]);
 succeeded(await h.call('/api/platform/v1/merchants/'+b.merchant.id+'/status','PATCH',{status:'suspended'},h.platformToken));assert.equal(await scanMerchantClocks(b.merchant.id),0);
 succeeded(await h.call('/api/platform/v1/merchants/'+b.merchant.id+'/status','PATCH',{status:'active'},h.platformToken));assert.equal(await scanMerchantClocks(b.merchant.id),1);assert.equal(await scanMerchantClocks(a.merchant.id),0);
 await assert.rejects(inTenant(a.merchant.id,()=>scanMerchantClocks(b.merchant.id)));await assert.rejects(runtimePool.query('SELECT * FROM clock_reminders'));
});
test('pauses prevent new reminders and changed deadlines get new durable reminders without resending the former deadline',async()=>{
 await inTenant(a.merchant.id,()=>tenantQuery('UPDATE order_items SET clock_paused_at=now(),duration=2 WHERE id=$1',[clockA.id]));assert.equal(await scanMerchantClocks(a.merchant.id),0);
 await inTenant(a.merchant.id,()=>tenantQuery('UPDATE order_items SET clock_paused_at=NULL WHERE id=$1',[clockA.id]));assert.equal(await scanMerchantClocks(a.merchant.id),1);assert.equal(await scanMerchantClocks(a.merchant.id),0);
 const rows=await inTenant(a.merchant.id,async()=>(await tenantQuery('SELECT expected_end_at FROM clock_reminders WHERE order_item_id=$1',[clockA.id])).rows);assert.equal(rows.length,2);assert.notEqual(String(rows[0].expected_end_at),String(rows[1].expected_end_at));
});
