import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {harness,succeeded} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(()=>h.stop());
const body={version:0,name:'新客礼遇',enabled:true,delay_days:0,dormant_days:30,coupon_name:'欢迎券',coupon_value:20,coupon_min_amount:68,coupon_expire_days:14,channel:'in_app'};
test('drafts do not create data; concurrent scans issue once and remain merchant and store scoped',async()=>{
 const drafts=succeeded(await h.api(a.token,a.stores[0].id,'/marketing/workflows'));assert.equal(drafts.length,6);assert(drafts.every((d:any)=>d.id===null));
 assert.equal(await inTenant(a.merchant.id,async()=>(await tenantQuery('SELECT count(*)::int n FROM marketing_workflows')).rows[0].n),0);
 for(const merchant of [a,b])succeeded(await h.api(merchant.token,merchant.stores[0].id,'/members','POST',{name:'同名会员',phone:'13900001234'}));
 succeeded(await h.api(a.token,a.stores[1].id,'/members','POST',{name:'另一店会员',phone:'13900005678'}));
 const saved=succeeded(await h.api(a.token,a.stores[0].id,'/marketing/workflows/new_member_no_visit','PUT',body));assert.equal(saved.version,1);
 assert.equal((await h.api(a.token,a.stores[0].id,'/marketing/workflows/new_member_no_visit','PUT',body)).status,409);
 const scans=await Promise.all([1,2,3].map(()=>h.api(a.token,a.stores[0].id,'/marketing/run','POST',{})));scans.forEach(succeeded);
 const rows=succeeded(await h.api(a.token,a.stores[0].id,'/marketing/outbox'));assert.equal(rows.length,1);assert.equal(rows[0].status,'issued');assert(rows[0].coupon_id);
 assert.equal(succeeded(await h.api(b.token,b.stores[0].id,'/marketing/outbox')).length,0);
 assert.equal(succeeded(await h.api(a.token,a.stores[1].id,'/marketing/outbox')).length,0);
 assert.equal(succeeded(await h.api(a.token,a.stores[0].id,'/marketing/run','POST',{})).issued,0);
 assert.equal((await h.api(b.token,b.stores[0].id,'/marketing/outbox/'+rows[0].id+'/retry','POST',{reason:'越权'})).status,404);
});
test('external channels reject activation and failed dispatch preserves the frozen coupon terms for retry',async()=>{
 assert.equal((await h.api(b.token,b.stores[0].id,'/marketing/workflows/birthday','PUT',{...body,channel:'sms'})).status,409);
 succeeded(await h.api(b.token,b.stores[0].id,'/marketing/workflows/new_member_no_visit','PUT',body));
 // Force a genuine coupon constraint failure, then restore the captured configuration.
 await inTenant(b.merchant.id,()=>tenantQuery("INSERT INTO marketing_outbox(store_id,workflow_id,member_id,trigger_key,scheduled_at,channel,detail) SELECT w.store_id,w.id,m.id,'new:'||m.id,now(),'in_app',$1 FROM marketing_workflows w JOIN members m ON m.store_id=w.store_id",[JSON.stringify({workflow:{...body,coupon_value:-1}})]));
 for(let i=0;i<3;i++){const result=succeeded(await h.api(b.token,b.stores[0].id,'/marketing/run','POST',{}));assert.equal(result.failed,1);await inTenant(b.merchant.id,()=>tenantQuery('UPDATE marketing_outbox SET next_retry_at=NULL'))}
 let rows=succeeded(await h.api(b.token,b.stores[0].id,'/marketing/outbox'));assert.equal(rows[0].status,'failed');assert.equal(rows[0].coupon_id,null);
 await inTenant(b.merchant.id,()=>tenantQuery('UPDATE marketing_outbox SET detail=$1',[JSON.stringify({workflow:body})]));
 succeeded(await h.api(b.token,b.stores[0].id,'/marketing/workflows/new_member_no_visit','PUT',{...body,version:1,coupon_value:99}));
 succeeded(await h.api(b.token,b.stores[0].id,'/marketing/outbox/'+rows[0].id+'/retry','POST',{reason:'修复任务配置后重试'}));
 assert.equal(succeeded(await h.api(b.token,b.stores[0].id,'/marketing/run','POST',{})).issued,1);
 rows=succeeded(await h.api(b.token,b.stores[0].id,'/marketing/outbox'));assert.equal(rows[0].status,'issued');
 assert.equal(Number(await inTenant(b.merchant.id,async()=>(await tenantQuery('SELECT value FROM coupons WHERE id=$1',[rows[0].coupon_id])).rows[0].value)),20);
});

test('all dated triggers select eligible episodes once; disabled members are skipped at dispatch',async()=>{
 const c=await h.onboard();const store=c.stores[0].id;
 const member=succeeded(await h.api(c.token,store,'/members','POST',{name:'周期会员',phone:'13900007890'}));
 for(const trigger of ['birthday','dormant','member_expiry','after_visit','booking_cancel'])succeeded(await h.api(c.token,store,'/marketing/workflows/'+trigger,'PUT',{...body,name:trigger}));
 await inTenant(c.merchant.id,async()=>{
  await tenantQuery("UPDATE members SET birthday='1990-'||to_char(now(),'MM-DD'),expiry=to_char(now()+interval '3 days','YYYY-MM-DD'),created_at=now()-interval '40 days' WHERE id=$1",[member.id]);
  await tenantQuery("INSERT INTO orders(store_id,member_id,order_no,status,closed_at) VALUES($1,$2,'visit-episode','closed',now()-interval '35 days')",[store,member.id]);
  await tenantQuery("UPDATE marketing_workflows SET created_at=now()-interval '40 days'");
  await tenantQuery("INSERT INTO reservations(store_id,customer_phone,status,cancelled_at) VALUES($1,'13900007890','cancelled',now()-interval '1 hour')",[store]);
 });
 const scan=succeeded(await h.api(c.token,store,'/marketing/run','POST',{}));assert.equal(scan.scheduled,5);assert.equal(scan.issued,5);assert.equal(scan.failed,0);
 assert.equal(succeeded(await h.api(c.token,store,'/marketing/run','POST',{})).scheduled,0);
 // A queued invitation must not issue after the member is frozen.
 await inTenant(c.merchant.id,async()=>{
  await tenantQuery("INSERT INTO marketing_outbox(store_id,workflow_id,member_id,trigger_key,scheduled_at,channel,detail) SELECT store_id,id,$1,'disabled-member',now(),'in_app',$2 FROM marketing_workflows WHERE trigger_type='birthday'",[member.id,JSON.stringify({workflow:body})]);
  await tenantQuery("UPDATE members SET status='frozen' WHERE id=$1",[member.id]);
 });
 assert.equal(succeeded(await h.api(c.token,store,'/marketing/run','POST',{})).issued,0);
 assert.equal(await inTenant(c.merchant.id,async()=>(await tenantQuery("SELECT status FROM marketing_outbox WHERE trigger_key='disabled-member'")).rows[0].status),'skipped');
});
