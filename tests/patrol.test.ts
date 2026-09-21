import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(()=>h.stop());
const api=(path:string,method='GET',body?:unknown,m=a,key=randomUUID())=>h.call('/api/merchant/v1'+path,method,body,m.token,m.stores[0].id,key);
test('patrol retries issue one record; concurrent terminals cannot overwrite a newer inspection',async()=>{
 const room=succeeded(await api('/rooms','POST',{room_no:'PATROL-1'})),body={room_id:room.id,status:'issue',remark:'空调异常',expected_id:0},key=randomUUID();
 const first=succeeded(await api('/patrol','POST',body,a,key)),retry=succeeded(await api('/patrol','POST',body,a,key));assert.equal(first.record.id,retry.record.id);assert.deepEqual(first.summary,{total:1,issues:1});
 const results=await Promise.all(['normal','issue'].map(status=>api('/patrol','POST',{...body,status,expected_id:first.record.id})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const view=succeeded(await api('/patrols'));assert.equal(view.list.length,2);assert.equal(view.latest.length,1);assert.equal(view.summary.issues,view.latest[0].status==='issue'?1:0);
 assert.equal((await api('/patrol','POST',{...body,room_id:room.id},b)).status,404);assert.equal(succeeded(await api('/patrols','GET',undefined,b)).list.length,0);
});
test('patrol input and current store grants are enforced',async()=>{
 const room=succeeded(await api('/rooms','POST',{room_no:'PATROL-2'}));assert.equal((await api('/patrol','POST',{room_id:room.id,status:'issue',remark:'',expected_id:0})).status,400);assert.equal((await api('/patrols?date=2026-02-30')).status,400);
 const user=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'patrol-floor',password,name:'巡房收银'}));succeeded(await h.api(a.token,undefined,'/users/'+user.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'floor'}]}));const login=succeeded(await h.call('/api/merchant/v1/auth/login','POST',{merchant_code:a.merchant.code,username:'patrol-floor',password}));
 const actor={...a,token:login.token},saved=succeeded(await api('/patrol','POST',{room_id:room.id,status:'normal',expected_id:0},actor));assert.equal(saved.record.user_id,user.id);
 succeeded(await h.api(a.token,undefined,'/users/'+user.id+'/grants','PUT',{grants:[]}));assert.equal((await api('/patrols','GET',undefined,actor)).status,403);
});
