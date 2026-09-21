import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {harness,succeeded} from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>,a:any;
before(async()=>{h=await harness();a=await h.onboard()});after(()=>h.stop());
test('member dates reject impossible calendar values and omitted updates preserve existing dates',async()=>{
 const store=a.stores[0].id;
 for(const date of ['2026-02-29','2026-13-01','2026-04-31','09-08'])assert.equal((await h.api(a.token,store,'/members','POST',{name:'日期校验',birthday:date})).status,400);
 let member=succeeded(await h.api(a.token,store,'/members','POST',{name:'有效日期',birthday:'2000-02-29',expiry:'2030-12-31'}));
 member=succeeded(await h.api(a.token,store,'/members','POST',{id:member.id,name:'仅改名'}));assert.equal(member.birthday,'2000-02-29');assert.equal(member.expiry,'2030-12-31');
 member=succeeded(await h.api(a.token,store,'/members','POST',{id:member.id,name:'长期会员',expiry:''}));assert.equal(member.expiry,null);assert.equal(member.birthday,'2000-02-29');
});
test('editing a member name cannot reset card type, discount, phone or existing assets',async()=>{
 const store=a.stores[0].id,member=succeeded(await h.api(a.token,store,'/members','POST',{name:'次卡档案',card_type:'times',times_balance:2,discount:.8,phone:'13900006789',reason:'测试期初次数'}));
 const updated=succeeded(await h.api(a.token,store,'/members','POST',{id:member.id,name:'只改称呼'}));assert.equal(updated.card_type,'times');assert.equal(updated.times_balance,2);assert.equal(updated.discount,.8);assert.equal(updated.phone,'13900006789');
});
