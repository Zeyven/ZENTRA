import pg from 'pg';
import {test,after} from 'node:test';import assert from 'node:assert/strict';import {harness,succeeded,password} from './helpers.js';import {inTenant,tenantQuery,platformTransaction} from '../apps/server/src/db/pools.js';import {io} from 'socket.io-client';
let h:Awaited<ReturnType<typeof harness>>;after(async()=>{if(h)await h.stop()});
test('platform can disable and restore one store, with scoped IDs and optimistic concurrency',async()=>{
 h=await harness({realtime:true});const a=await h.onboard(),b=await h.onboard(),s=a.stores[0],base='/api/platform/v1/merchants/'+a.merchant.id+'/stores';
 const list=()=>h.call(base,'GET',undefined,h.platformToken);const manage=(operation:string,version:number)=>h.call(base+'/'+s.id+'/manage','POST',{operation,version,reason:'门店维护'},h.platformToken);
 assert.equal((await h.call(base,'GET',undefined,a.token)).status,401);
 const initial=succeeded(await list()).items.find((r:any)=>r.id===s.id);assert.equal(initial.version,0);
 const races=await Promise.all([manage('disable',0),manage('restore',0)]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 let row=succeeded(await list()).items.find((r:any)=>r.id===s.id);succeeded(await manage('disable',row.version));
 assert.equal((await h.api(a.token,s.id,'/rooms','POST',{room_no:'STOP'})).status,409);
 row=succeeded(await list()).items.find((r:any)=>r.id===s.id);succeeded(await manage('restore',row.version));succeeded(await h.api(a.token,s.id,'/rooms','POST',{room_no:'RESTORED'}));
 assert.equal((await h.call('/api/platform/v1/merchants/'+b.merchant.id+'/stores/'+s.id+'/manage','POST',{operation:'disable',version:2,reason:'错误归属'},h.platformToken)).status,404);
 assert.equal(succeeded(await h.api(b.token,undefined,'/stores')).length,2);
});
test('force deletion is permanent and audited, rejects wrong confirmation and password, preserves linked history and other stores',async()=>{
 const a=await h.onboard(),s=a.stores[0],other=a.stores[1],base='/api/platform/v1/merchants/'+a.merchant.id+'/stores';
 const room=succeeded(await h.api(a.token,s.id,'/rooms','POST',{room_no:'KEEP'}));succeeded(await h.api(a.token,s.id,'/sessions','POST',{resource_id:room.id}));const member=succeeded(await h.api(a.token,s.id,'/members','POST',{name:'连锁会员'}));succeeded(await h.api(a.token,s.id,'/members/recharge','POST',{customer_id:member.id,amount:100,method:'现金'}));
 const body={operation:'delete',version:0,reason:'关闭测试门店',confirmation_code:s.code,current_password:password};const call=(data:any)=>h.call(base+'/'+s.id+'/manage','POST',data,h.platformToken);
 assert.equal((await call({...body,current_password:'Wrong-password'})).status,403);assert.equal((await call({...body,confirmation_code:other.code})).status,409);
 const socket=io(h.origin,{autoConnect:false,reconnection:false,transports:['websocket'],auth:{token:a.token,store_id:s.id,protocol_version:1}});
 try{await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect()});const disconnected=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Deleted store socket stayed active')),10000);socket.once('disconnect',()=>{clearTimeout(timer);resolve()})});const deleted=succeeded(await call(body));assert.equal(deleted.recoverable,false);await disconnected;}finally{socket.disconnect()}
 await platformTransaction(async c=>{await c.query('SELECT platform_store_directory($1)',[a.merchant.id]);assert.equal((await c.query("SELECT coalesce(current_setting('app.merchant_id',true),'') value")).rows[0].value,'')});
 const migration=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await migration.connect();try{await migration.query('BEGIN');await migration.query("SELECT set_config('app.merchant_id',$1,true)",[a.merchant.id]);await assert.rejects(migration.query('UPDATE stores SET deleted_at=NULL,status=1 WHERE id=$1',[s.id]),/cannot be changed or restored/)}finally{await migration.query('ROLLBACK');await migration.end()}
 assert.equal((await call(body)).code,'STORE_DELETED');assert.equal((await call({operation:'restore',version:1,reason:'尝试恢复'})).code,'STORE_DELETED');
 assert.equal((await h.api(a.token,s.id,'/snapshot')).status,403);assert.equal((await h.api(a.token,undefined,'/stores/'+s.id,'PUT',{name:s.name,status:1})).status,404);assert.equal(succeeded(await h.api(a.token,undefined,'/stores')).length,1);
 assert.equal((await h.call('/api/public/v1/'+a.merchant.code+'/'+s.code+'/queue')).status,404);
 const remaining=await inTenant(a.merchant.id,async()=>({orders:(await tenantQuery('SELECT count(*) n FROM orders WHERE store_id=$1',[s.id])).rows[0].n,balance:(await tenantQuery('SELECT balance FROM members WHERE id=$1',[member.id])).rows[0].balance,hidden:(await tenantQuery('SELECT * FROM stores WHERE id=$1',[s.id])).rowCount}));assert.deepEqual(remaining,{orders:1,balance:100,hidden:0});
 succeeded(await h.api(a.token,other.id,'/members'));const rows=succeeded(await h.call(base,'GET',undefined,h.platformToken)).items;assert(rows.find((r:any)=>r.id===s.id).deleted_at);assert.equal(rows.find((r:any)=>r.id===other.id).status,1);
 const audit=succeeded(await h.call('/api/platform/v1/activity?merchant_id='+a.merchant.id,'GET',undefined,h.platformToken));assert.equal(audit.items.filter((r:any)=>r.action==='store.delete').length,1);assert(!JSON.stringify(audit).includes(password));
 await assert.rejects(inTenant(a.merchant.id,()=>tenantQuery('SELECT platform_manage_store($1,$2,$3,$4,$5,$6,$7)',[a.merchant.id,s.id,'restore',1,h.platformUserId,'越权',null])),/permission denied/);
});

