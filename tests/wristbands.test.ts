import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded} from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard()});after(()=>h.stop());
const api=(path:string,method='GET',body?:unknown,m=a,s=0,key=randomUUID())=>h.call('/api/merchant/v1'+path,method,body,m.token,m.stores[s].id,key);
test('fixed card bindings resolve read-only, reject foreign rooms and remain after real checkout',async()=>{
 const room=succeeded(await api('/rooms','POST',{room_no:'FIXED'})),foreign=succeeded(await api('/rooms','POST',{room_no:'FIXED'},b));
 const band=succeeded(await api('/wristbands','POST',{code:'CARD',deposit:30}));
 const binding={room_id:room.id,card_uid:'CHIP',reason:'固定房间'};
 assert.equal((await api('/wristbands/'+band.id+'/binding','POST',{...binding,room_id:foreign.id})).status,404);
 succeeded(await api('/wristbands/'+band.id+'/binding','POST',binding));
 const lookup=succeeded(await api('/wristbands/resolve?card=CHIP'));assert.equal(lookup.room_id,room.id);assert.equal(lookup.order_id,null);
 assert.equal((await api('/wristbands/resolve?card=CHIP','GET',undefined,b)).status,404);
 succeeded(await api('/shifts/start','POST',{start_cash:0}));const order=succeeded(await api('/sessions','POST',{resource_id:room.id,wristband_no:'CARD'}));
 assert.equal(succeeded(await api('/wristbands/resolve?card=CARD')).order_id,order.id);
 // 未结账（订单处于 open/挂单）时，手牌档案必须拒绝删除（新契约保留的守卫）。
 assert.equal((await api('/wristbands/'+band.id,'DELETE')).status,409,'未结账时不得删除手牌档案');
 assert.equal((await api('/wristbands/'+band.id+'/binding','POST',{...binding,room_id:null})).status,409);
 assert.equal((await api('/wristbands/'+band.id+'/deposit','POST',{deposit:60})).status,409);
 const item=succeeded(await api('/items','POST',{name:'茶水',type:'product',price:10}));
 const added=succeeded(await api('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id,quantity:1}));
 succeeded(await api('/sessions/'+order.id+'/checkout','POST',{version:added.order.version,payments:[{method:'现金',amount:10}]}));
 assert.equal(succeeded(await api('/wristbands/resolve?card=CHIP')).room_id,room.id,'结账后固定绑定仍保留');
 // 新契约（docs/FIX-WRISTBAND-MANAGEMENT-2026-09-18.md）：结账后手牌回到 idle、订单 closed，
 // 删除为物理删除，编号/芯片随档案移除并可复用；仅“使用中/关联未结账或挂单”才拒绝。
 const removed=succeeded(await api('/wristbands/'+band.id,'DELETE'));assert.equal(removed.deleted,true,'结账后应物理删除手牌档案');
 assert.equal((await api('/wristbands/resolve?card=CHIP')).status,404,'删除后芯片卡号不再解析到原档案');
 const recreated=succeeded(await api('/wristbands','POST',{code:'CARD',deposit:30}));assert.notEqual(recreated.id,band.id,'手牌编号 CARD 可复用为新档案');
 const rebound=succeeded(await api('/wristbands/'+recreated.id+'/binding','POST',{room_id:null,card_uid:'CHIP',reason:'复用芯片卡号'}));assert.equal(rebound.card_uid,'CHIP','芯片卡号 CHIP 可复用');
});
test('concurrent chip configuration and new printed codes cannot create ambiguous identities',async()=>{
 const one=succeeded(await api('/wristbands','POST',{code:'A'})),two=succeeded(await api('/wristbands','POST',{code:'B'}));
 const results=await Promise.all([one,two].map(band=>api('/wristbands/'+band.id+'/binding','POST',{room_id:null,card_uid:'SHARED',reason:'并发测试'})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await api('/wristbands','POST',{code:'SHARED'})).status,409);
 const key=randomUUID(),body={deposit:40};assert.equal(succeeded(await api('/wristbands/'+one.id+'/deposit','POST',body,a,0,key)).deposit,40);assert.equal(succeeded(await api('/wristbands/'+one.id+'/deposit','POST',body,a,0,key)).deposit,40);
});
