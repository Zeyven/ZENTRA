import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(()=>h.stop());
const api=(path:string,method='GET',body?:unknown,token=a.token)=>h.api(token,a.stores[0].id,path,method,body);
const base=(m:any=a)=>'/api/public/v1/'+m.merchant.code+'/'+m.stores[0].code+'/coupons';
const configuration={version:0,name:'核验领券',type:'cash',value:20,min_amount:68,expire_days:14,active:true,max_claims:10};
async function invite(campaign:number,member:number,token=a.token){const data=succeeded(await api('/coupon-campaigns/'+campaign+'/invite','POST',{member_id:member,verification:'in_person',reason:'现场核对会员卡号与本人'},token));return new URLSearchParams(new URL(data.claim_url).hash.slice(1)).get('claim')!}
const claim=(token:string,m=a,key=randomUUID())=>h.call(base(m)+'/claim','POST',{},token,undefined,key);
test('public coupon claim requires an exact tenant invitation and issues once across different retry keys',async()=>{
 const campaign=succeeded(await api('/coupon-campaigns','POST',configuration)),member=succeeded(await api('/members','POST',{name:'领券会员'})),token=await invite(campaign.id,member.id);
 assert.equal((await claim(token,b)).status,404);assert.equal((await claim('x'.repeat(43))).status,404);
 const results=await Promise.all([claim(token),claim(token)]);results.forEach(succeeded);assert.equal(results[0].data.coupon.id,results[1].data.coupon.id);
 const detail=succeeded(await h.call(base()+'/invitation','GET',undefined,token));assert.equal(detail.claimed,true);assert(!JSON.stringify(detail).includes(member.name));
 assert.equal((await api('/coupon-campaigns/'+campaign.id+'/invite','POST',{member_id:member.id,verification:'in_person',reason:'重复核验'})).status,409);
 assert.equal(await inTenant(a.merchant.id,async()=>(await tenantQuery('SELECT count(*)::int n FROM coupons WHERE claim_campaign_id=$1',[campaign.id])).rows[0].n),1);
});
test('campaign capacity is atomic across members; changed configuration invalidates unused invitations',async()=>{
 const campaign=succeeded(await api('/coupon-campaigns','POST',{...configuration,max_claims:1}));const members=await Promise.all([1,2].map(async n=>succeeded(await api('/members','POST',{name:'限量会员'+n}))));const tokens=await Promise.all(members.map(m=>invite(campaign.id,m.id)));
 const results=await Promise.all(tokens.map(token=>claim(token)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(succeeded(await api('/coupon-campaigns')).find((r:any)=>r.id===campaign.id).issued_count,1);
 const other=succeeded(await api('/coupon-campaigns','POST',configuration)),token=await invite(other.id,members[0].id);succeeded(await api('/coupon-campaigns','POST',{...configuration,id:other.id,version:1,value:30}));assert.equal((await claim(token)).code,'CAMPAIGN_CHANGED');
});
test('revoked staff cannot leave an unused authorization capable of issuing member benefits',async()=>{
 const user=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'claim-manager',password,name:'核验员工'}));succeeded(await h.api(a.token,undefined,'/users/'+user.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'manager'}]}));const login=succeeded(await h.call('/api/merchant/v1/auth/login','POST',{merchant_code:a.merchant.code,username:'claim-manager',password}));
 const campaign=succeeded(await api('/coupon-campaigns','POST',configuration)),member=succeeded(await api('/members','POST',{name:'授权撤销会员'})),token=await invite(campaign.id,member.id,login.token);
 succeeded(await h.api(a.token,undefined,'/users/'+user.id+'/grants','PUT',{grants:[]}));assert.equal((await claim(token)).code,'CLAIM_AUTHORIZATION_REVOKED');
 assert.equal(await inTenant(a.merchant.id,async()=>(await tenantQuery('SELECT count(*)::int n FROM coupons WHERE claim_campaign_id=$1',[campaign.id])).rows[0].n),0);
});
