import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createApp} from '../apps/server/src/app.js';
import {closePools,inTenant,platformPool,runtimePool,tenantQuery} from '../apps/server/src/db/pools.js';
import {hashPassword} from '../apps/server/src/security.js';
assert.equal(process.env.NODE_ENV,'test');
assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/za_spa_saas_test');
const password='Test-Secret-867!';
const server=createServer(createApp());
let origin:string,platformToken:string,platformUserId:number,a:any,b:any,staff:any;
async function request(path:string,method='GET',body?:unknown,token?:string,store?:number){
 const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(store?{'X-Store-ID':String(store)}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,...await response.json() as any};
}
const merchant=(path:string,method='GET',body?:unknown,token=a?.token,store?:number)=>request('/api/merchant/v1'+path,method,body,token,store);
const platform=(path:string,method='GET',body?:unknown)=>request('/api/platform/v1'+path,method,body,platformToken);
async function onboard(code:string){
 const created=await platform('/merchants','POST',{code,name:code,member_mode:'merchant'});assert.equal(created.status,200,JSON.stringify(created));
 const activated=await merchant('/auth/activate','POST',{token:created.data.invite.token,username:'13800138000',password,name:'老板'},undefined);assert.equal(activated.status,200,JSON.stringify(activated));
 const again=await merchant('/auth/activate','POST',{token:created.data.invite.token,username:'13800138000',password,name:'老板'},undefined);assert.equal(again.status,400);
 const login=await merchant('/auth/login','POST',{merchant_code:code,username:'13800138000',password},undefined);assert.equal(login.status,200,JSON.stringify(login));
 return {...login.data,invite:created.data.invite};
}
before(async()=>{
 await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING',['test-admin-8-20',await hashPassword(password),'测试平台管理员']);
 server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const logged=await platform('/auth/login','POST',{username:'test-admin-8-20',password});assert.equal(logged.status,200,JSON.stringify(logged));platformToken=logged.data.token;platformUserId=logged.data.user.id;
 const prefix=randomUUID().slice(0,8).toUpperCase();a=await onboard('A-'+prefix);b=await onboard('B-'+prefix);
});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await closePools()});
test('same phone and store code remain independent across merchants; invite is one-use',async()=>{
 assert.notEqual(a.merchant.id,b.merchant.id);assert.notEqual(a.user.id,b.user.id);
 const sa=await merchant('/stores','POST',{code:'001',name:'A 一店'});assert.equal(sa.status,200,JSON.stringify(sa));a.store=sa.data;
 const sb=await merchant('/stores','POST',{code:'001',name:'B 一店'},b.token);assert.equal(sb.status,200);b.store=sb.data;
 const sa2=await merchant('/stores','POST',{code:'002',name:'A 二店'});a.store2=sa2.data;
 assert.equal((await merchant('/stores')).data.length,2);
 assert.equal((await merchant('/stores','GET',undefined,b.token)).data.length,1);
});
test('platform credential cannot access merchant APIs and tenant body fields cannot override identity',async()=>{
 assert.equal((await merchant('/stores','GET',undefined,platformToken)).status,401);
 assert.equal((await merchant('/stores','POST',{code:'BAD',name:'bad',merchant_id:b.merchant.id})).status,400);
 assert.equal((await merchant('/session','GET',undefined,a.token,b.store.id)).status,403);
 assert.equal((await merchant('/stores/'+b.store.id,'PUT',{name:'越权'})).status,404);
});
test('RLS denies missing context, cross-tenant writes, truncate and DDL; pooled context clears',async()=>{
 await assert.rejects(runtimePool.query('SELECT * FROM stores'),(e:any)=>e.code==='42501');
 const rows=await inTenant(a.merchant.id,async()=>tenantQuery('SELECT * FROM stores'));
 assert.equal(rows.rows.length,2);assert(rows.rows.every(s=>s.merchant_id===a.merchant.id));
 await assert.rejects(inTenant(a.merchant.id,()=>tenantQuery('INSERT INTO stores(merchant_id,code,name) VALUES($1,$2,$3)',[b.merchant.id,'EVIL','拒绝'])),(e:any)=>e.code==='42501');
 await assert.rejects(runtimePool.query('TRUNCATE stores'),(e:any)=>['42501','0A000'].includes(e.code));
 await assert.rejects(runtimePool.query('CREATE TABLE forbidden(id int)'),(e:any)=>e.code==='42501');
 const client=await runtimePool.connect();try{const row=await client.query("SELECT current_setting('app.merchant_id',true) AS tenant");assert(!row.rows[0].tenant)}finally{client.release()}
 const permissions=(await runtimePool.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];assert.deepEqual(permissions,{rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false});
});
test('rollback discards writes and tenant context, nested tenant switch rejects',async()=>{
 await assert.rejects(inTenant(a.merchant.id,async()=>{await tenantQuery("INSERT INTO stores(code,name) VALUES('ROLLBACK','未提交')");throw Error('forced rollback')}));
 const rows=await inTenant(a.merchant.id,()=>tenantQuery("SELECT * FROM stores WHERE code='ROLLBACK'"));assert.equal(rows.rowCount,0);
 await assert.rejects(inTenant(a.merchant.id,()=>inTenant(b.merchant.id,async()=>true)));
 const row=await inTenant(b.merchant.id,()=>tenantQuery('SELECT * FROM stores'));assert.equal(row.rowCount,1);
});
test('employee store roles require explicit grants and revocation affects the next API call',async()=>{
 const created=await merchant('/users','POST',{username:'cashier',password,name:'收银员'});assert.equal(created.status,200);staff=created.data;
 let grants=await merchant(`/users/${staff.id}/grants`,'PUT',{grants:[{store_id:a.store.id,role:'floor'},{store_id:a.store2.id,role:'manager'}]});assert.equal(grants.status,200,JSON.stringify(grants));
 const login=await merchant('/auth/login','POST',{merchant_code:a.merchant.code,username:'cashier',password},undefined);staff.token=login.data.token;
 assert.equal(login.data.stores.length,2);assert.equal((await merchant('/session','GET',undefined,staff.token,a.store2.id)).status,200);
 assert.equal((await merchant('/users','GET',undefined,staff.token)).status,403);
 const rejected=await merchant(`/users/${staff.id}/grants`,'PUT',{grants:[{store_id:b.store.id,role:'manager'}]});assert.equal(rejected.status,403);
 assert.equal((await merchant('/session','GET',undefined,staff.token,a.store.id)).status,200,'failed replacement must preserve old grants');
 grants=await merchant(`/users/${staff.id}/grants`,'PUT',{grants:[{store_id:a.store2.id,role:'manager'}]});assert.equal(grants.status,200);
 assert.equal((await merchant('/session','GET',undefined,staff.token,a.store.id)).status,403);
 assert.equal((await merchant('/session','GET',undefined,staff.token,a.store2.id)).status,200);
});
test('support access is explicit, short-lived, revocable and audited under platform actor',async()=>{
 const operator=(await merchant('/support/operators')).data.items.find((row:any)=>row.id===platformUserId);assert(operator);
 assert.equal((await merchant('/support/grants','POST',{platform_user_id:operator.id,duration_minutes:61})).status,400);
 const grant=await merchant('/support/grants','POST',{platform_user_id:operator.id});assert.equal(grant.status,200,JSON.stringify(grant));assert.equal(grant.data.scope,'read');
 const support=await platform('/support-grants/'+grant.data.id+'/session','POST',{});assert.equal(support.status,200,JSON.stringify(support));
 const token=support.data.token;assert.equal((await merchant('/stores','GET',undefined,token)).data.length,2);
 assert.equal((await merchant('/stores','POST',{code:'SUPPORT',name:'拒绝'},token)).status,403);
 assert.equal((await merchant('/session','GET',undefined,token,b.store.id)).status,403);
 const logs=await inTenant(a.merchant.id,()=>tenantQuery("SELECT * FROM audit_events WHERE action='support.access'"));assert(logs.rows.some(r=>r.platform_user_id===operator.id&&r.user_id===null));
 assert.equal((await merchant('/support/grants/'+grant.data.id,'DELETE')).status,200);
 assert.equal((await merchant('/stores','GET',undefined,token)).status,403);
});
test('suspension blocks new operations, preserves owner reads, and does not affect another merchant',async()=>{
 assert.equal((await platform('/merchants/'+a.merchant.id+'/status','PATCH',{status:'suspended'})).status,200);
 assert.equal((await merchant('/stores','POST',{code:'003',name:'拒绝'})).status,403);
 assert.equal((await merchant('/stores')).status,200);
 assert.equal((await merchant('/session','GET',undefined,staff.token,a.store2.id)).status,403);
 assert.equal((await merchant('/stores','GET',undefined,b.token)).status,200);
 assert.equal((await platform('/merchants/'+a.merchant.id+'/status','PATCH',{status:'active'})).status,200);
});
test('account disable and password changes do not affect same account at another merchant',async()=>{
 assert.equal((await merchant('/users/'+staff.id,'PATCH',{active:0})).status,200);
 assert.equal((await merchant('/session','GET',undefined,staff.token)).status,401);
 assert.equal((await merchant('/auth/password','POST',{current_password:password,new_password:password+'2'})).status,200);
 assert.equal((await merchant('/session')).status,401);
 assert.equal((await merchant('/session','GET',undefined,b.token)).status,200);
 const relogin=await merchant('/auth/login','POST',{merchant_code:a.merchant.code,username:'13800138000',password:password+'2'},undefined);assert.equal(relogin.status,200);a.token=relogin.data.token;
});
test('parallel independent logins do not deadlock the platform pool; merchant rate limits are independent',async()=>{
 const logins=await Promise.all(Array.from({length:10},()=>merchant('/auth/login','POST',{merchant_code:b.merchant.code,username:'13800138000',password},undefined)));assert(logins.every(r=>r.status===200));
 for(let i=0;i<5;i++)assert.equal((await merchant('/auth/login','POST',{merchant_code:a.merchant.code,username:'13800138000',password:'wrong'},undefined)).status,401);
 assert.equal((await merchant('/auth/login','POST',{merchant_code:a.merchant.code,username:'13800138000',password:password+'2'},undefined)).status,429);
 assert.equal((await merchant('/auth/login','POST',{merchant_code:b.merchant.code,username:'13800138000',password},undefined)).status,200);
});
