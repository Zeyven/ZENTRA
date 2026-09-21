import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {harness,succeeded} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(async()=>{if(h)await h.stop()});
const api=(path:string,method='GET',body?:unknown)=>h.api(a.token,a.stores[0].id,path,method,body);
test('deletion physically removes a band, releases its number and chip, and keeps tenant isolation',async()=>{
 const band=succeeded(await api('/wristbands','POST',{code:'001',deposit:50}));
 succeeded(await api('/wristbands/'+band.id+'/binding','POST',{room_id:null,card_uid:'CHIP1',reason:'测试卡号'}));
 assert.equal((await h.api(b.token,b.stores[0].id,'/wristbands/'+band.id,'DELETE')).status,404);
 assert.equal(succeeded(await api('/wristbands/'+band.id,'DELETE')).deleted,true);
 assert.equal(succeeded(await api('/wristbands?include_inactive=1')).length,0);
 const count=await inTenant(a.merchant.id,()=>tenantQuery('SELECT count(*)::int n FROM wristbands WHERE id=$1',[band.id]));assert.equal(count.rows[0].n,0);
 assert.equal(succeeded(await api('/wristbands/batch','POST',{codes:['001','001','CHIP1']})).added,2);
 const recreated=succeeded(await api('/wristbands')).find((w:any)=>w.code==='001');assert.notEqual(recreated.id,band.id);assert.equal(Number(recreated.deposit),0);
});
test('open and suspended orders prevent deletion; closed order snapshots survive deletion',async()=>{
 await api('/shifts/start','POST',{start_cash:0});
 const room=succeeded(await api('/rooms','POST',{room_no:'W1'}));const band=succeeded(await api('/wristbands','POST',{code:'BUSY'}));
 const session=succeeded(await api('/sessions','POST',{resource_id:room.id,wristband_no:'BUSY'}));
 assert.equal((await api('/wristbands/'+band.id,'DELETE')).code,'WRISTBAND_BUSY');
 await inTenant(a.merchant.id,async()=>{await tenantQuery("UPDATE wristbands SET status='idle' WHERE id=$1",[band.id]);await tenantQuery("UPDATE orders SET status='suspended' WHERE id=$1",[session.id])});
 assert.equal((await api('/wristbands/'+band.id,'DELETE')).code,'WRISTBAND_BUSY');
 await inTenant(a.merchant.id,()=>tenantQuery("UPDATE orders SET status='closed' WHERE id=$1",[session.id]));
 succeeded(await api('/wristbands/'+band.id,'DELETE'));
 const order=await inTenant(a.merchant.id,()=>tenantQuery('SELECT wristband_no FROM orders WHERE id=$1',[session.id]));assert.equal(order.rows[0].wristband_no,'BUSY');
});
test('legacy inactive records can be deleted and chip conflicts roll back the entire batch',async()=>{
 const band=succeeded(await api('/wristbands','POST',{code:'OLD'}));await inTenant(a.merchant.id,()=>tenantQuery('UPDATE wristbands SET active=0 WHERE id=$1',[band.id]));
 assert.equal((await api('/wristbands/batch','POST',{codes:['NEW','OLD']})).code,'WRISTBAND_ARCHIVED');assert(!succeeded(await api('/wristbands')).some((w:any)=>w.code==='NEW'));
 succeeded(await api('/wristbands/'+band.id,'DELETE'));assert.equal(succeeded(await api('/wristbands/batch','POST',{codes:['OLD']})).added,1);
 const chip=succeeded(await api('/wristbands','POST',{code:'C1'}));succeeded(await api('/wristbands/'+chip.id+'/binding','POST',{room_id:null,card_uid:'CHIP2',reason:'测试卡号'}));
 assert.equal((await api('/wristbands/batch','POST',{codes:['NEW','CHIP2']})).code,'CARD_CONFLICT');assert(!succeeded(await api('/wristbands')).some((w:any)=>w.code==='NEW'));
});
