import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {harness,succeeded} from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>,a:any;
before(async()=>{h=await harness();a=await h.onboard()});after(()=>h.stop());
test('shared member levels use issuing-store thresholds, concurrent net sales, and exact checkout reversals',async()=>{
 const from=a.stores[0].id,to=a.stores[1].id;
 const api=(store:number,path:string,method='GET',body?:unknown)=>h.api(a.token,store,path,method,body);
 succeeded(await api(from,'/member-levels','POST',{name:'银卡',min_consume:100,discount:.9}));succeeded(await api(from,'/member-levels','POST',{name:'金卡',min_consume:200,discount:.8}));
 succeeded(await api(to,'/member-levels','POST',{name:'错误门店等级',min_consume:1,discount:.5}));
 const member=succeeded(await api(from,'/members','POST',{name:'通用会员'}));
 async function prepare(store:number){const room=succeeded(await api(store,'/rooms','POST',{room_no:'L1'})),item=succeeded(await api(store,'/items','POST',{name:'会员商品',type:'product',price:100}));let order=succeeded(await api(store,'/sessions','POST',{resource_id:room.id,customer_id:member.id}));return succeeded(await api(store,'/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id,quantity:1}))}
 const opened=[await prepare(from),await prepare(to)],closed=await Promise.all(opened.map((o,i)=>api([from,to][i],'/sessions/'+o.id+'/checkout','POST',{version:o.version,payments:[{method:'现金',amount:100}]})));closed.forEach(succeeded);
 let profile=succeeded(await api(from,'/members/'+member.id));assert.equal(profile.level,'金卡');assert.equal(profile.discount,1);
 succeeded(await api(to,'/sessions/'+closed[1].data.id+'/reverse-checkout','POST',{version:closed[1].data.version,reason:'退回第二店消费'}));profile=succeeded(await api(from,'/members/'+member.id));assert.equal(profile.level,'银卡');
 succeeded(await api(from,'/members','POST',{id:member.id,name:'通用会员',level:'特邀会员'}));
 succeeded(await api(from,'/sessions/'+closed[0].data.id+'/reverse-checkout','POST',{version:closed[0].data.version,reason:'退回第一店消费'}));profile=succeeded(await api(from,'/members/'+member.id));assert.equal(profile.level,'特邀会员');
 profile=succeeded(await api(from,'/members','POST',{id:member.id,name:'改名保留等级'}));assert.equal(profile.level,'特邀会员');
});
