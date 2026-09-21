import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {businessDate} from '../apps/server/src/services/dates.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});
after(async()=>{if(h)await h.stop()});
const api=(path:string,method='GET',body?:unknown,key=randomUUID())=>h.api(a.token,a.stores[0].id,path,method,body,key);

test('counted cash rejects stale totals and unexplained differences; retry preserves one closed snapshot',async()=>{
 const shift=succeeded(await api('/shifts/start','POST',{start_cash:100}));
 assert.equal((await api('/shifts/end','POST',{actual_cash:99,expected_shift_id:shift.id,expected_cash:90,note:'已核对'})).code,'SHIFT_CHANGED');
 assert.equal((await api('/shifts/end','POST',{actual_cash:99,expected_shift_id:shift.id,expected_cash:100})).code,'DIFFERENCE_REASON_REQUIRED');
 assert.equal(succeeded(await api('/shifts?current=1')).status,'open');
 const key=randomUUID(),body={actual_cash:99,expected_shift_id:shift.id,expected_cash:100,note:'现金短款一元'};
 const closed=succeeded(await api('/shifts/end','POST',body,key));
 assert.equal(closed.cash_difference,-1);assert.equal(closed.actual_cash,99);
 assert.deepEqual(succeeded(await api('/shifts/end','POST',body,key)),closed);
 assert.equal(succeeded(await api('/shifts')).find((r:any)=>r.id===closed.id).cash_difference,-1);
});

test('report source entries paginate without duplicates and cannot cross store, tenant, or report authorization',async()=>{
 const store=a.stores[0].id;
 await inTenant(a.merchant.id,()=>tenantQuery("INSERT INTO shift_entries(store_id,cashier_id,kind,amount,reason) SELECT $1,$2,'deposit',1,'测试分页' FROM generate_series(1,105)",[store,a.user.id]));
 const date=businessDate(),path='/reports/entries?date='+date;
 const first=succeeded(await api(path));assert.equal(first.rows.length,100);assert(first.next);
 const second=succeeded(await api(path+'&before='+first.next));assert.equal(second.rows.length,5);assert.equal(second.next,null);
 assert.equal(new Set([...first.rows,...second.rows].map((r:any)=>r.id)).size,105);
 assert.equal(succeeded(await h.api(a.token,a.stores[1].id,path)).rows.length,0);
 assert.equal(succeeded(await h.api(b.token,b.stores[0].id,path)).rows.length,0);
 assert.equal((await h.api(b.token,store,path)).status,403);
 const staff=succeeded(await api('/users','POST',{name:'营业员工',username:'ux-staff',password}));
 succeeded(await h.api(a.token,undefined,'/users/'+staff.id+'/grants','PUT',{grants:[{store_id:store,role:'floor',pages:['board'],actions:[]}]}));
 const token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'ux-staff',password})).token;
 assert.equal((await h.api(token,store,path)).status,403);
 assert.equal((await api('/reports/entries?date=2026-02-30')).status,400);
});

test('queue changes preserve operator reason and previous order, isolated from other stores',async()=>{
 const one=succeeded(await api('/technicians','POST',{name:'技师甲',code:'U1'})),two=succeeded(await api('/technicians','POST',{name:'技师乙',code:'U2'}));
 const queue=succeeded(await api('/technicians/queue-order'));
 succeeded(await api('/technicians/queue-order','POST',{ids:[two.id,one.id],version:queue.version,reason:'换班调整'}));
 const history=succeeded(await api('/technicians/queue-history'));
 assert.equal(history[0].detail.reason,'换班调整');assert.deepEqual(history[0].detail.before,queue.rows.map((r:any)=>r.id));assert.deepEqual(history[0].detail.ids,[two.id,one.id]);
 assert.equal(succeeded(await h.api(a.token,a.stores[1].id,'/technicians/queue-history')).length,0);
 assert.equal(succeeded(await h.api(b.token,b.stores[0].id,'/technicians/queue-history')).length,0);
});

test('operating alerts expose gateway and cash differences only with the corresponding page grants',async()=>{
 await inTenant(a.merchant.id,()=>tenantQuery("INSERT INTO hardware_gateways(id,store_id,name,token_hash,created_by,expires_at) VALUES($1,$2,'待确认网关','test-only',$3,now()+interval '1 day')",[randomUUID(),a.stores[0].id,a.user.id]));
 const owner=succeeded(await api('/alerts')).list;
 assert(owner.some((r:any)=>r.type==='gateway_attention'&&r.detail.includes('尚未收到')));
 assert(owner.some((r:any)=>r.type==='cash_difference'));
 const staff=succeeded(await api('/users','POST',{name:'仅房态店长',username:'ux-manager',password}));
 succeeded(await h.api(a.token,undefined,'/users/'+staff.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'manager',pages:['board'],actions:[],operations:[]}]}));
 const token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'ux-manager',password})).token;
 assert.deepEqual(succeeded(await h.api(token,a.stores[0].id,'/alerts')).list,[]);
 assert.deepEqual(succeeded(await h.api(b.token,b.stores[0].id,'/alerts')).list,[]);
});
