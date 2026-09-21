import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
import {businessDate} from '../apps/server/src/services/dates.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,tech:any,other:any,techToken:string,rooms:any[];
const api=(p:string,m='GET',body?:any,key=randomUUID(),token=a.token,store=a.stores[0].id)=>h.api(token,store,p,m,body,key);
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard();rooms=[];for(const room_no of ['501','502'])rooms.push(succeeded(await api('/rooms','POST',{room_no})));tech=succeeded(await api('/technicians','POST',{name:'接收技师',code:'T-1'}));other=succeeded(await api('/technicians','POST',{name:'其他技师',code:'T-2'}));const user=succeeded(await api('/users','POST',{username:'warning-tech',password,name:'技师登录'}));succeeded(await api('/users/'+user.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'technician',technician_id:tech.id}]}));tech.userId=user.id;techToken=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'warning-tech',password})).token;const item=succeeded(await api('/items','POST',{name:'警告测试服务',type:'service',price:100,duration:60}));succeeded(await api('/technicians/'+tech.id+'/clock','POST',{status:'on'}));let order=succeeded(await api('/sessions','POST',{resource_id:rooms[0].id}));succeeded(await api('/sessions/'+order.id+'/items','POST',{catalog_id:item.id,technician_id:tech.id,version:order.version}))});after(()=>h.stop());
test('warning timestamps handle epoch milliseconds, duplicate broadcasts post once, and only the current store and assigned technician rooms are visible',async()=>{
 const key=randomUUID(),broadcast=succeeded(await api('/clocks/warnings/broadcast','POST',{},key));assert.equal(broadcast.room_count,2);assert.deepEqual(succeeded(await api('/clocks/warnings/broadcast','POST',{},key)),broadcast);
 const view=succeeded(await api('/clocks/warnings'));assert.equal(view.warnings.length,2);assert(view.warnings.every((w:any)=>w.created_at>1700000000000&&w.expires_at-w.created_at===1800000));
 const own=succeeded(await api('/clocks/warnings','GET',undefined,undefined,techToken));assert.equal(own.can_send,false);assert.equal(own.warnings.length,1);assert.equal(own.warnings[0].room_id,rooms[0].id);
 assert.deepEqual(succeeded(await h.api(b.token,b.stores[0].id,'/clocks/warnings')).warnings,[]);assert.equal((await api('/clocks/warnings','GET',undefined,undefined,techToken,b.stores[0].id)).status,403);
 assert.equal((await api('/clocks/warnings/broadcast','POST',{},undefined,techToken)).status,403);
 const warning=own.warnings[0];assert.equal((await api('/clocks/warnings/'+warning.id+'/cancel','POST',{},undefined,techToken)).status,403);
 const acknowledged=succeeded(await api('/clocks/warnings/'+warning.id+'/acknowledge','POST',{},undefined,techToken));assert.equal(acknowledged.acknowledged_by,tech.userId);assert(acknowledged.acknowledged_at>0);
 const foreignRoom=view.warnings.find((w:any)=>w.room_id===rooms[1].id);assert.equal((await api('/clocks/warnings/'+foreignRoom.id+'/acknowledge','POST',{},undefined,techToken)).status,404);succeeded(await api('/clocks/warnings/'+foreignRoom.id+'/cancel','POST',{}));assert.equal((await api('/clocks/warnings/'+foreignRoom.id+'/acknowledge','POST',{})).status,409);
});
test('warning limits and foreign room validation roll back the complete broadcast rather than sending a partial batch',async()=>{
 const foreign=succeeded(await h.api(b.token,b.stores[0].id,'/rooms','POST',{room_no:'FOREIGN'}));assert.equal((await api('/clocks/warnings','POST',{room_id:foreign.id,message:'禁止跨商家'})).status,404);
 await inTenant(a.merchant.id,()=>tenantQuery(`INSERT INTO room_warnings(store_id,room_id,message,sent_by,request_key,request_hash,created_at,expires_at) SELECT $1,$2,'容量边界验证',$3,'capacity-'||g,'test',$4::bigint,$4::bigint+1800000 FROM generate_series(1,99) g`,[a.stores[0].id,rooms[0].id,a.user.id,Date.now()]));
 const before=succeeded(await api('/clocks/warnings')).warnings.length;assert.equal((await api('/clocks/warnings/broadcast','POST',{})).status,409);assert.equal(succeeded(await api('/clocks/warnings')).warnings.length,before);
 const customKey=randomUUID(),custom=succeeded(await api('/clocks/warnings','POST',{room_id:rooms[0].id,message:'最后一条'},customKey));assert.equal(succeeded(await api('/clocks/warnings','POST',{room_id:rooms[0].id,message:'最后一条'},customKey)).id,custom.id);
 assert.equal((await api('/clocks/warnings','POST',{room_id:rooms[0].id,message:'超过上限'})).status,409);
});
test('queue ordering validates the complete store set and versions; attendance counts distinct workdays and only ended sessions',async()=>{
 const initial=succeeded(await api('/technicians/queue-order'));succeeded(await api('/technicians/queue-order','POST',{version:initial.version,ids:[other.id,tech.id]}));assert.equal((await api('/technicians/queue-order','POST',{version:initial.version,ids:[tech.id,other.id]})).status,409);
 const changed=succeeded(await api('/technicians/queue-order'));assert.equal((await api('/technicians/queue-order','POST',{version:changed.version,ids:[tech.id,tech.id]})).status,400);assert.equal(succeeded(await api('/technicians/queue','GET',undefined,undefined,techToken)).length,1);
 const date=businessDate(),month=date.slice(0,7);await inTenant(a.merchant.id,()=>tenantQuery("INSERT INTO attendance(store_id,technician_id,date,clock_in_at,clock_out_at) VALUES($1,$2,$3,$4,$5),($1,$2,$3,$6,$7)",[a.stores[0].id,other.id,date,date+'T08:00:00+08:00',date+'T09:00:00+08:00',date+'T10:00:00+08:00',date+'T12:00:00+08:00']));
 const monthly=succeeded(await api('/attendance/monthly?month='+month));assert.equal(monthly.find((r:any)=>r.id===other.id).work_days,1);assert.equal(monthly.find((r:any)=>r.id===other.id).total_minutes,180);assert.equal(monthly.find((r:any)=>r.id===tech.id).open_sessions,1);
 const own=succeeded(await api('/attendance?date='+date,'GET',undefined,undefined,techToken));assert(own.every((r:any)=>r.technician_id===tech.id));assert.equal((await api('/attendance?date=2026-02-30')).status,400);assert.equal((await api('/attendance/monthly?month=2026-13')).status,400);
});
