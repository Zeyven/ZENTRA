import {test,after} from 'node:test';import assert from 'node:assert/strict';import {harness,succeeded} from './helpers.js';import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>;after(async()=>{if(h)await h.stop()});
test('owner can disable, re-enable and delete only empty stores; another tenant is isolated',async()=>{
 h=await harness();const a=await h.onboard(),b=await h.onboard();const store=succeeded(await h.api(a.token,undefined,'/stores','POST',{code:'EMPTY',name:'空门店'}));
 await inTenant(a.merchant.id,()=>tenantQuery("INSERT INTO maintenance_events(store_id,source,level,request_id,method,route,status_code,duration_ms) VALUES($1,'request','info',gen_random_uuid(),'GET','/session',200,1)",[store.id]));
 const path='/stores/'+store.id;assert.equal((await h.api(a.token,undefined,path,'DELETE')).status,409);
 assert.equal((await h.api(b.token,undefined,path,'PUT',{name:'越权',status:0})).status,404);
 assert.equal((await h.api(a.token,undefined,path,'PUT',{name:'空门店',status:0})).status,200);
 assert.equal(succeeded(await h.api(a.token,undefined,'/stores','GET')).find((s:any)=>s.id===store.id).status,0);
 assert.equal((await h.api(a.token,undefined,path,'PUT',{name:'空门店',status:1})).status,200);
 assert.equal((await h.api(a.token,undefined,path,'PUT',{name:'空门店',status:0})).status,200);
 assert.equal((await h.api(b.token,undefined,path,'DELETE')).status,404);
 assert.equal((await h.api(a.token,undefined,path,'DELETE')).status,200);
 assert(!succeeded(await h.api(a.token,undefined,'/stores','GET')).some((s:any)=>s.id===store.id));
 const logs=await inTenant(a.merchant.id,()=>tenantQuery("SELECT * FROM audit_events WHERE action='store.deleted' AND object_id=$1",[String(store.id)]));assert.equal(logs.rowCount,1);
});
test('configured store deletion fails atomically without deleting related records',async()=>{
 const a=await h.onboard(),store=a.stores[0];
 succeeded(await h.api(a.token,store.id,'/rooms','POST',{room_no:'101',room_name:'有配置',room_type:'包间',capacity:2}));
 succeeded(await h.api(a.token,undefined,'/stores/'+store.id,'PUT',{name:store.name,status:0}));
 const diagnostic=await inTenant(a.merchant.id,()=>tenantQuery("INSERT INTO maintenance_events(store_id,source,level,request_id,method,route,status_code,duration_ms) VALUES($1,'request','info',gen_random_uuid(),'GET','/session',200,1) RETURNING id",[store.id]));
 const r=await h.api(a.token,undefined,'/stores/'+store.id,'DELETE');assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.code,'STORE_HAS_HISTORY');assert.equal((await inTenant(a.merchant.id,()=>tenantQuery('SELECT count(*) n FROM maintenance_events WHERE id=$1',[diagnostic.rows[0].id]))).rows[0].n,1);
 const room=await inTenant(a.merchant.id,()=>tenantQuery('SELECT * FROM rooms WHERE store_id=$1',[store.id]));assert.equal(room.rowCount,1);assert(succeeded(await h.api(a.token,undefined,'/stores','GET')).some((s:any)=>s.id===store.id));
});


