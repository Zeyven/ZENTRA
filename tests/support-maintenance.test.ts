import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {harness,succeeded} from './helpers.js';
import {inTenant,tenantQuery,platformPool} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(async()=>{await h.stop()});
async function grant(scope:string){const g=succeeded(await h.api(a.token,undefined,'/support/grants','POST',{platform_user_id:h.platformUserId,scope,duration_minutes:30}));const session=succeeded(await h.call('/api/platform/v1/support-grants/'+g.id+'/session','POST',{},h.platformToken));return {g,token:session.token};}
test('maintenance grants permit owner operations with the real platform operator audited; read and configuration stay restricted',async()=>{
 for(const scope of ['read','configuration']){const s=await grant(scope);assert.equal((await h.api(s.token,a.stores[0].id,'/shifts/start','POST',{start_cash:0})).status,403);}
 const s=await grant('maintenance');const band=succeeded(await h.api(s.token,a.stores[0].id,'/wristbands','POST',{code:'SUPPORT'}));
 succeeded(await h.api(s.token,a.stores[0].id,'/wristbands/'+band.id,'DELETE'));
 const shift=succeeded(await h.api(s.token,a.stores[0].id,'/shifts/start','POST',{start_cash:0}));assert.equal(shift.cashier_id,a.user.id);
 const member=succeeded(await h.api(s.token,a.stores[0].id,'/members','POST',{name:'授权资产维护'}));
 const adjusted=succeeded(await h.api(s.token,a.stores[0].id,'/members/'+member.id+'/adjust','POST',{version:1,principal:10,reason:'核对后调整'}));assert.equal(adjusted.member.balance,10);
 const funded=succeeded(await h.api(s.token,a.stores[0].id,'/members/recharge','POST',{customer_id:member.id,amount:20}));
 const refund=succeeded(await h.api(s.token,a.stores[0].id,'/members/'+member.id+'/reverse-recharge','POST',{recharge_id:funded.operation.id,reason:'授权退款测试'}));assert.equal(refund.member.balance,10);
 const audit=await inTenant(a.merchant.id,()=>tenantQuery("SELECT * FROM audit_events WHERE support_grant_id=$1 AND action='wristbands.deleted'",[s.g.id]));assert.equal(audit.rows[0].platform_user_id,h.platformUserId);assert.equal(audit.rows[0].user_id,a.user.id);
 assert.equal((await h.api(s.token,b.stores[0].id,'/wristbands')).status,403);
 assert.equal((await h.api(s.token,undefined,'/support/grants','POST',{platform_user_id:h.platformUserId,scope:'maintenance',duration_minutes:30})).status,403);
 succeeded(await h.api(a.token,undefined,'/support/grants/'+s.g.id,'DELETE'));
 assert.equal((await h.api(s.token,a.stores[0].id,'/wristbands')).status,403);
});
test('maintenance requires a live grant, active owner and live platform session',async()=>{
 const expired=await grant('maintenance');
 await platformPool.query("UPDATE support_grants SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.g.id]);
 assert.equal((await h.api(expired.token,a.stores[0].id,'/wristbands')).status,403);
 const s=await grant('maintenance');
 await inTenant(a.merchant.id,()=>tenantQuery('UPDATE merchant_users SET active=0 WHERE id=$1',[a.user.id]));
 assert.equal((await h.api(s.token,a.stores[0].id,'/wristbands')).status,403);
 await inTenant(a.merchant.id,()=>tenantQuery('UPDATE merchant_users SET active=1 WHERE id=$1',[a.user.id]));
 await platformPool.query('UPDATE platform_sessions SET revoked_at=now() WHERE user_id=$1',[h.platformUserId]);
 assert.equal((await h.api(s.token,a.stores[0].id,'/wristbands')).status,401);
});
