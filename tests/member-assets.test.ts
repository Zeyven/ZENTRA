import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {defaultPages,defaultActions} from '@za-spa/contracts';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,staff:any;
const api=(p:string,m='GET',body?:any,store=a.stores[0].id,token=a.token,key?:string)=>h.api(token,store,p,m,body,key);
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard();staff=succeeded(await api('/users','POST',{username:'assets-manager',password,name:'会员管理店长'}));succeeded(await api('/users/'+staff.id+'/grants','PUT',{grants:a.stores.map((s:any)=>({store_id:s.id,role:'manager'}))}));staff.token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'assets-manager',password})).token;for(const s of a.stores)succeeded(await api('/permissions','PUT',{pages:{manager:defaultPages.manager},actions:{manager:[...defaultActions.manager,'adjust','reverseSettle']}},s.id))});
after(async()=>h.stop());
test('asset version covers another store recharge; stale adjustments and simultaneous fresh request keys cannot overwrite the account',async()=>{
 const member=succeeded(await api('/members','POST',{name:'权益并发'}));assert.equal(member.asset_version,1);
 const funded=succeeded(await api('/members/recharge','POST',{customer_id:member.id,amount:100,gift_amount:20},a.stores[1].id));assert.equal(funded.member.asset_version,2);
 assert.equal((await api('/members/'+member.id+'/adjust','POST',{version:1,principal:10,reason:'旧资产快照'})).code,'ASSETS_CHANGED');
 const body={version:2,principal:10,bonus:-5,points:8,reason:'按核对结果调整'},keys=[randomUUID(),randomUUID()];
 const results=await Promise.all(keys.map(key=>api('/members/'+member.id+'/adjust','POST',body,a.stores[0].id,a.token,key)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const index=results.findIndex(r=>r.status===200),result=succeeded(results[index]);assert.equal(result.member.asset_version,3);assert.equal(result.member.balance,110);assert.equal(result.member.bonus_balance,15);assert.equal(result.member.points,8);
 assert.deepEqual(succeeded(await api('/members/'+member.id+'/adjust','POST',body,a.stores[0].id,a.token,keys[index])),result);
 const page=succeeded(await api('/members/'+member.id+'/assets'));assert.equal(page.items.filter((r:any)=>r.type==='adjust').length,1);
 assert.equal((await api('/members/'+member.id+'/adjust','POST',{principal:100,reason:'缺少版本'})).status,400);
});
test('asset and point history are store scoped for employees; owners can inspect FIFO funding origins but other merchants cannot',async()=>{
 const member=succeeded(await api('/members','POST',{name:'通用卡对账'})),funded=succeeded(await api('/members/recharge','POST',{customer_id:member.id,amount:30,points:10},a.stores[1].id));
 assert.deepEqual(succeeded(await api('/members/'+member.id+'/assets','GET',undefined,a.stores[0].id,staff.token)).items,[]);
 assert.deepEqual(succeeded(await api('/members/'+member.id+'/points','GET',undefined,a.stores[0].id,staff.token)),[]);
 assert.equal((await api('/members/'+member.id+'/assets/'+funded.operation.id,'GET',undefined,a.stores[0].id,staff.token)).status,404);
 const owner=succeeded(await api('/members/'+member.id+'/assets'));assert.equal(owner.items[0].store_id,a.stores[1].id);
 const allocation=succeeded(await api('/members/'+member.id+'/assets/'+funded.operation.id));assert.equal(allocation.allocations[0].origin_store_id,a.stores[1].id);assert.equal(allocation.allocations[0].principal,30);
 assert.equal((await api('/members/'+member.id+'/assets','GET',undefined,b.stores[0].id,b.token)).status,404);
 assert.equal((await api('/members/'+member.id+'/assets/'+funded.operation.id,'GET',undefined,b.stores[0].id,b.token)).status,404);
});
test('recharge refund and cached replay require both original-store member page and reversal permission',async()=>{
 const member=succeeded(await api('/members','POST',{name:'跨店退款授权'}));
 const funded=succeeded(await api('/members/recharge','POST',{customer_id:member.id,amount:20},a.stores[1].id)),path='/members/'+member.id+'/reverse-recharge',body={recharge_id:funded.operation.id,reason:'原充值退款'},key=randomUUID();
 succeeded(await api(path,'POST',body,a.stores[0].id,staff.token,key));
 succeeded(await api('/permissions','PUT',{pages:{manager:defaultPages.manager.filter(p=>p!=='members')},actions:{manager:[...defaultActions.manager,'reverseSettle']}},a.stores[1].id));
 assert.equal((await api(path,'POST',body,a.stores[0].id,staff.token,key)).code,'ORIGIN_STORE_FORBIDDEN');
 succeeded(await api('/permissions','PUT',{pages:{manager:defaultPages.manager},actions:{manager:defaultActions.manager}},a.stores[1].id));
 assert.equal((await api(path,'POST',body,a.stores[0].id,staff.token,key)).code,'ORIGIN_STORE_FORBIDDEN');
 const entries=await inTenant(a.merchant.id,async()=>(await tenantQuery("SELECT amount,store_id FROM shift_entries WHERE kind='recharge_reversal' AND asset_operation_id IN(SELECT id FROM asset_operations WHERE member_id=$1)",[member.id])).rows);assert.deepEqual(entries,[{amount:-20,store_id:a.stores[0].id}]);
 succeeded(await api('/permissions','PUT',{pages:{manager:defaultPages.manager},actions:{manager:[...defaultActions.manager,'adjust','reverseSettle']}},a.stores[1].id));
});
test('an owner can freeze a card and reverse unused funding without reopening spending or erasing the original record',async()=>{
 const member=succeeded(await api('/members','POST',{name:'冻结退款'})),funded=succeeded(await api('/members/recharge','POST',{customer_id:member.id,amount:50,gift_amount:5}));
 succeeded(await api('/members/'+member.id+'/status','POST',{status:'frozen'}));
 const reversed=succeeded(await api('/members/'+member.id+'/reverse-recharge','POST',{recharge_id:funded.operation.id,reason:'冻结卡退还原款'}));assert.equal(reversed.member.status,'frozen');assert.equal(reversed.member.balance,0);assert.equal(reversed.member.bonus_balance,0);assert.equal(reversed.member.asset_version,3);
 const ledger=succeeded(await api('/members/'+member.id+'/assets'));assert.equal(ledger.items.length,2);assert.equal(ledger.items.find((r:any)=>r.id===funded.operation.id).reversed_by,reversed.operation.id);
 succeeded(await api('/members/'+member.id,'DELETE'));assert.equal((await api('/members/'+member.id+'/adjust','POST',{version:3,points:1,reason:'归档后不能恢复资产'})).code,'MEMBER_ARCHIVED');
});
test('refund approval is invalidated by intervening asset operations even when totals return to their former values',async()=>{
 const member=succeeded(await api('/members','POST',{name:'审批权益版本'})),funded=succeeded(await api('/members/recharge','POST',{customer_id:member.id,amount:20}));
 succeeded(await api('/settings','POST',{approval_thresholds:JSON.stringify({refund:10,discount:0,inventory_adjustment:0})}));
 const path='/members/'+member.id+'/reverse-recharge',body={recharge_id:funded.operation.id,reason:'审批后复核'},request=await api(path,'POST',body);assert.equal(request.status,202);assert.equal(request.pending_approval,true);
 succeeded(await api('/approvals/'+request.approval_id+'/review','POST',{status:'approved'},a.stores[0].id,staff.token));
 const added=succeeded(await api('/members/'+member.id+'/adjust','POST',{version:2,points:1,reason:'临时补录积分'}));succeeded(await api('/members/'+member.id+'/adjust','POST',{version:added.member.asset_version,points:-1,reason:'撤回补录积分'}));
 assert.equal((await api(path,'POST',{...body,approval_id:request.approval_id})).code,'APPROVAL_INVALID');
 const account=succeeded(await api('/members/'+member.id));assert.equal(account.balance,20);assert.equal(account.points,0);assert.equal(account.transactions.find((r:any)=>r.id===funded.operation.id).reversed_by,null);
 const approval=succeeded(await api('/approvals?status=approved')).find((r:any)=>r.id===request.approval_id);assert(approval);succeeded(await api('/settings','POST',{approval_thresholds:JSON.stringify({refund:0,discount:0,inventory_adjustment:0})}));
});
