import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createApp} from '../apps/server/src/app.js';
import {closePools,platformPool} from '../apps/server/src/db/pools.js';
import {hashPassword} from '../apps/server/src/security.js';
assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/za_spa_saas_test');
const server=createServer(createApp()),prefix='CONSOLE-'+randomUUID().slice(0,8).toUpperCase(),password='Ctl-Test-Pwd-987!';
let origin:string,token:string,otherToken:string,merchant:any,merchantToken:string,uid:number,otherUid:number;
async function call(path:string,method='GET',body?:unknown,auth=token){const r=await fetch(origin+'/api/platform/v1'+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json() as any}}
async function merchantCall(path:string,body:any){const r=await fetch(origin+'/api/merchant/v1'+path,{method:'POST',headers:{'Content-Type':'application/json',...(merchantToken?{Authorization:'Bearer '+merchantToken}:{})},body:JSON.stringify(body)});return {status:r.status,...await r.json() as any}}
before(async()=>{
 for(const username of [prefix,prefix+'-B'])await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3)',[username.toLowerCase(),await hashPassword(password),username]);
 server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const a=await call('/auth/login','POST',{username:prefix,password},'');assert.equal(a.status,200,JSON.stringify(a));token=a.data.token;uid=a.data.user.id;
 const b=await call('/auth/login','POST',{username:prefix+'-B',password},'');assert.equal(b.status,200,JSON.stringify(b));otherToken=b.data.token;otherUid=b.data.user.id;
 merchant=(await call('/merchants','POST',{code:prefix,name:prefix,member_mode:'store'})).data;
});
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));await closePools()});
test('directory searches literal input, paginates and filters owner activation without business data',async()=>{
 let r=await call('/directory?search='+prefix+'&limit=1');assert.equal(r.status,200);assert.equal(r.data.total,1);assert.equal(r.data.items[0].activation,'pending');assert(!JSON.stringify(r.data).includes('token_hash'));
 assert.equal((await call('/directory?search='+prefix+'&page=2&limit=1')).data.items.length,0);
 assert.equal((await call('/directory?search='+prefix+'&activation=activated')).data.total,0);
 assert.equal((await call('/directory?search='+encodeURIComponent("%' OR 1=1 --"))).data.total,0);
 assert.equal((await call('/directory?limit=9999')).status,400);
 const snapshot=await call('/overview');assert.equal(snapshot.status,200);assert(snapshot.data.merchants.total>=1);
 await merchantCall('/auth/activate',{token:merchant.invite.token,username:'owner',password,name:'独立老板'});
 merchantToken=(await merchantCall('/auth/login',{merchant_code:prefix,username:'owner',password})).data.token;
 assert.equal((await call('/directory?search='+prefix+'&activation=activated')).data.total,1);
 for(const path of ['/overview','/directory','/activity','/sessions']){assert.equal((await call(path,'GET',undefined,merchantToken)).status,401);assert.equal((await call(path,'GET',undefined,'')).status,401)}
});
test('merchant profile edits validate optimistic concurrency and audit exact reason',async()=>{
 const id=merchant.merchant.id,newName=prefix+' UPDATED';
 const r=await call('/merchants/'+id+'/profile','PATCH',{name:newName,previous_name:prefix,reason:'纠正商家名称'});assert.equal(r.status,200);assert.equal(r.data.name,newName);
 assert.equal((await call('/merchants/'+id+'/profile','PATCH',{name:'stale',previous_name:prefix,reason:'旧页面'})).status,409);
 assert.equal((await call('/merchants/'+id+'/profile','PATCH',{name:'bad',previous_name:newName,reason:'',merchant_id:randomUUID()})).status,400);
 const logs=await call('/activity?merchant_id='+id+'&search=merchant.profile.updated');assert.equal(logs.data.total,1);assert.equal(logs.data.items[0].detail.reason,'纠正商家名称');assert.equal(logs.data.items[0].operator_name,prefix);
 const future=await call('/activity?merchant_id='+id+'&from=2099-01-01T00:00:00.000Z');assert.equal(future.data.total,0);
 assert.equal((await call('/activity?from=2099-01-01T00:00:00.000Z&to=2000-01-01T00:00:00.000Z')).status,400);
});
test('service status reason is retained and scoped to intended merchant',async()=>{
 const r=await call('/merchants/'+merchant.merchant.id+'/status','PATCH',{status:'suspended',reason:'经营暂停'});assert.equal(r.status,200);
 assert.equal((await call('/directory?search='+prefix+'&status=suspended')).data.total,1);
 const logs=await call('/activity?merchant_id='+merchant.merchant.id+'&search=merchant.status');assert.equal(logs.data.items[0].detail.reason,'经营暂停');
 await call('/merchants/'+merchant.merchant.id+'/status','PATCH',{status:'active',reason:'恢复服务'});
});
test('platform sessions only list own sessions and revocation invalidates selected login',async()=>{
 const extra=(await call('/auth/login','POST',{username:prefix,password},'')).data.token;
 const own=await call('/sessions');assert(own.data.items.some((s:any)=>s.current));
 const victim=(await call('/sessions','GET',undefined,extra)).data.items.find((s:any)=>s.current);
 assert.equal((await call('/sessions/'+victim.id+'/revoke','POST',{},otherToken)).status,404);
 assert.equal((await call('/sessions/'+victim.id+'/revoke','POST',{})).status,200);
 assert.equal((await call('/session','GET',undefined,extra)).status,401);assert.equal((await call('/session')).status,200);
 assert.equal((await call('/session','GET',undefined,otherToken)).status,200);
});
test('support operator can relinquish only their own owner-issued grant',async()=>{
 const grant=await merchantCall('/support/grants',{platform_user_id:uid});assert.equal(grant.status,200);
 const support=(await call('/support-grants/'+grant.data.id+'/session','POST',{})).data.token;
 assert.equal((await call('/support-grants/'+grant.data.id+'/revoke','POST',{},otherToken)).status,404);
 assert.equal((await call('/support-grants/'+grant.data.id+'/revoke','POST',{})).status,200);
 assert.equal((await call('/support-grants/'+grant.data.id+'/session','POST',{})).status,403);
 const r=await fetch(origin+'/api/merchant/v1/session',{headers:{Authorization:'Bearer '+support}});assert.equal(r.status,403);
});
test('password change rejects wrong current password and revokes all own sessions atomically',async()=>{
 assert.equal((await call('/account/password','POST',{current_password:'incorrect',new_password:'New-Ctl-Pwd-731!'})).status,400);
 assert.equal((await call('/session')).status,200);
 const r=await call('/account/password','POST',{current_password:password,new_password:'New-Ctl-Pwd-731!'});assert.equal(r.status,200);
 assert.equal((await call('/session')).status,401);
 assert.equal((await call('/auth/login','POST',{username:prefix,password},'')).status,401);
 const fresh=await call('/auth/login','POST',{username:prefix,password:'New-Ctl-Pwd-731!'},'');assert.equal(fresh.status,200);
 assert.equal((await call('/session','GET',undefined,otherToken)).status,200);
 const logs=await call('/activity?search=platform.password.changed','GET',undefined,fresh.data.token);assert(!JSON.stringify(logs).includes('New-Console-Password'));
});

