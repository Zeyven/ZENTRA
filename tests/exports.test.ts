import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(()=>h.stop());
const download=(token:string,query='')=>fetch(h.origin+'/api/merchant/v1/exports/business'+query,{headers:{Authorization:'Bearer '+token}});

test('owner export is complete, contains only its merchant, omits credentials and remains available after suspension',async()=>{
 const member=succeeded(await h.api(a.token,a.stores[0].id,'/members','POST',{name:'导出会员',phone:'13800138000'}));succeeded(await h.api(a.token,a.stores[1].id,'/members/recharge','POST',{customer_id:member.id,amount:25}));
 succeeded(await h.api(b.token,b.stores[0].id,'/members','POST',{name:'其他商家导出会员',phone:'13800138000'}));
 await inTenant(a.merchant.id,()=>tenantQuery("INSERT INTO booking_waitlist(store_id,customer_name,customer_phone,preferred_start,people,status,public_token,offer_token) VALUES($1,'候补','13800138000',now(),1,'waiting','DO_NOT_EXPORT_PUBLIC_TOKEN','DO_NOT_EXPORT_OFFER_TOKEN')",[a.stores[0].id]));
 succeeded(await h.call('/api/platform/v1/merchants/'+a.merchant.id+'/status','PATCH',{status:'suspended'},h.platformToken));
 const response=await download(a.token);assert.equal(response.status,200);const text=await response.text(),lines=text.trimEnd().split('\n'),complete=JSON.parse(lines.pop()!),records=lines.map(line=>JSON.parse(line));
 assert.equal(complete.type,'complete');assert.equal(complete.records,records.length-1);assert.equal(complete.sha256,createHash('sha256').update(lines.join('\n')+'\n').digest('hex'));
 assert.equal(records[0].merchant.id,a.merchant.id);assert(records.some(r=>r.dataset==='members'&&r.data.id===member.id));assert(records.some(r=>r.dataset==='asset_operations'&&r.data.principal===25));
 for(const row of records.slice(1))assert.equal(row.data.merchant_id,a.merchant.id);
 assert(!text.includes(b.merchant.id));assert(!text.includes('DO_NOT_EXPORT'));assert(!text.includes('scrypt-v1'));assert(!records.some(r=>/sessions|merchant_users|auth_attempts/.test(r.dataset??'')));
 assert.equal((await h.api(a.token,a.stores[0].id,'/members/recharge','POST',{customer_id:member.id,amount:25})).status,403);
 assert.equal((await download(a.token,'?merchant_id='+b.merchant.id)).status,400);
 assert.equal(await inTenant(a.merchant.id,async()=>(await tenantQuery("SELECT count(*)::int n FROM audit_events WHERE action='merchant.exported'")).rows[0].n),1);
});

test('employee and platform credentials cannot export merchant business records',async()=>{
 const user=succeeded(await h.api(b.token,undefined,'/users','POST',{username:'export-employee',password,name:'导出员工'}));succeeded(await h.api(b.token,undefined,'/users/'+user.id+'/grants','PUT',{grants:[{store_id:b.stores[0].id,role:'manager'}]}));
 const login=succeeded(await h.call('/api/merchant/v1/auth/login','POST',{merchant_code:b.merchant.code,username:'export-employee',password}));
 assert.equal((await download(login.token)).status,403);assert.equal((await download(h.platformToken)).status,401);
});
