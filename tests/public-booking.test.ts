import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
import {scanMerchantBookings} from '../apps/server/src/services/public-booking.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,item:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard();succeeded(await h.api(a.token,a.stores[0].id,'/rooms','POST',{room_no:'PUB1',capacity:2}));item=succeeded(await h.api(a.token,a.stores[0].id,'/items','POST',{name:'预约服务',type:'service',price:100,duration:60}))});after(()=>h.stop());
const path=(merchant:any=a,store=merchant.stores[0])=>'/api/public/v1/'+merchant.merchant.code+'/'+store.code+'/booking';
const call=(suffix:string,method='GET',body?:unknown,token?:string,key=randomUUID())=>h.call(path()+suffix,method,body,token,undefined,key);
const input=()=>({customer_name:'预约顾客',customer_phone:'13900002345',service_item_id:item.id,reserve_time:new Date(Date.now()+86400000).toISOString(),people:2});
test('public booking holds capacity atomically and requires a scoped bearer for every private detail',async()=>{
 const body=input(),options=succeeded(await call('/options'));assert.equal(options.services.length,1);assert.equal(options.payment_available,false);
 assert.equal(succeeded(await call('/quote','POST',body)).total_price,200);
 const key=randomUUID(),created=succeeded(await call('/reservations','POST',body,undefined,key));assert.equal(created.status,'pending');assert.equal(created.token.length,43);
 assert.deepEqual(succeeded(await call('/reservations','POST',body,undefined,key)),created);
 assert.equal((await call('/reservations','POST',{...body,customer_name:'重复时段'})).status,409);
 assert.equal((await call('/reservations/'+created.id)).status,400);assert.equal((await call('/reservations/'+created.id,'GET',undefined,'x'.repeat(43))).status,404);
 assert.equal((await h.call(path(b)+'/reservations/'+created.id,'GET',undefined,created.token)).status,404);
 const view=succeeded(await call('/reservations/'+created.id,'GET',undefined,created.token));assert(!JSON.stringify(view).includes(created.token));assert(!('public_token' in view));
 assert.equal((await call('/reservations/'+created.id+'/payment-order','POST',{},created.token)).code,'PAYMENT_NOT_CONNECTED');
 const changed=succeeded(await call('/reservations/'+created.id+'/reschedule','POST',{version:view.version,reserve_time:new Date(Date.parse(body.reserve_time)+2*3600000).toISOString()},created.token));assert.equal(changed.version,view.version+1);
 assert.equal((await call('/reservations/'+created.id+'/cancel','POST',{version:view.version},created.token)).status,409);
});
test('cancellation offers the freed slot once; only its waitlist bearer can confirm, expired offers cannot confirm',async()=>{
 const body={...input(),reserve_time:new Date(Date.now()+2*86400000).toISOString()},created=succeeded(await call('/reservations','POST',body));
 const queued=succeeded(await call('/waitlist','POST',{...body,customer_name:'候补顾客'}));
 succeeded(await call('/reservations/'+created.id+'/cancel','POST',{version:created.version},created.token));
 const offer=succeeded(await call('/waitlist/'+queued.id,'GET',undefined,queued.token));assert.equal(offer.status,'offered');assert(offer.offered_reservation_id);
 assert.equal((await call('/reservations/'+offer.offered_reservation_id,'GET',undefined,created.token)).status,404);
 const booking=succeeded(await call('/reservations/'+offer.offered_reservation_id,'GET',undefined,queued.token));
 const confirmed=succeeded(await call('/reservations/'+booking.id+'/confirm','POST',{version:booking.version},queued.token));assert.equal(confirmed.status,'pending');
 const second=succeeded(await call('/waitlist','POST',{...body,customer_name:'另一候补'}));succeeded(await call('/reservations/'+confirmed.id+'/cancel','POST',{version:confirmed.version},queued.token));
 const expiring=succeeded(await call('/waitlist/'+second.id,'GET',undefined,second.token));assert.equal(expiring.status,'offered');
 await inTenant(a.merchant.id,()=>tenantQuery("UPDATE booking_waitlist SET expires_at=now()-interval '1 minute' WHERE id=$1",[second.id]));
 assert.equal((await call('/reservations/'+expiring.offered_reservation_id+'/confirm','POST',{version:1},second.token)).status,409);
 await scanMerchantBookings(a.merchant.id);assert.equal(succeeded(await call('/waitlist/'+second.id,'GET',undefined,second.token)).status,'expired');
});
test('foreign resources and tenant overrides reject; required online deposits do not produce fake payments',async()=>{
 const body=input();assert.equal((await call('/quote','POST',{...body,merchant_id:b.merchant.id})).status,400);
 const foreign=succeeded(await h.api(b.token,b.stores[0].id,'/items','POST',{name:'其他商家服务',type:'service',price:10,duration:60}));assert.equal((await call('/quote','POST',{...body,service_item_id:foreign.id})).status,404);
 succeeded(await h.api(a.token,a.stores[0].id,'/settings','POST',{booking_deposit_type:'fixed',booking_deposit_value:'10'}));
 assert.equal(succeeded(await call('/quote','POST',body)).deposit_required,10);
 assert.equal((await call('/reservations','POST',body)).code,'PAYMENT_NOT_CONNECTED');
 assert.equal(await inTenant(a.merchant.id,async()=>(await tenantQuery('SELECT count(*)::int n FROM booking_payment_orders')).rows[0].n),0);
});

test('two customers racing for the last room commit only one reservation',async()=>{
 succeeded(await h.api(a.token,a.stores[0].id,'/settings','POST',{booking_deposit_value:'0'}));const body={...input(),reserve_time:new Date(Date.now()+4*86400000).toISOString()};
 const results=await Promise.all([call('/reservations','POST',body),call('/reservations','POST',{...body,customer_name:'并发顾客'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal(await inTenant(a.merchant.id,async()=>(await tenantQuery('SELECT count(*)::int n FROM reservations WHERE reserve_time=$1',[body.reserve_time])).rows[0].n),1);
});

test('staff can inspect scoped waitlists and cancel with a reason without exposing public credentials',async()=>{
 const queued=succeeded(await call('/waitlist','POST',{...input(),reserve_time:new Date(Date.now()+5*86400000).toISOString()}));
 const rows=succeeded(await h.api(a.token,a.stores[0].id,'/booking-waitlist'));assert(rows.some((r:any)=>r.id===queued.id));assert(!JSON.stringify(rows).includes(queued.token));assert(!rows.some((r:any)=>'public_token' in r));
 assert.equal(succeeded(await h.api(b.token,b.stores[0].id,'/booking-waitlist')).length,0);
 assert.equal((await h.api(b.token,b.stores[0].id,'/booking-waitlist/'+queued.id+'/cancel','POST',{version:1,reason:'跨商家'})).status,404);
 succeeded(await h.api(a.token,a.stores[0].id,'/booking-waitlist/'+queued.id+'/cancel','POST',{version:1,reason:'顾客电话取消'}));assert.equal(succeeded(await call('/waitlist/'+queued.id,'GET',undefined,queued.token)).status,'cancelled');
});
