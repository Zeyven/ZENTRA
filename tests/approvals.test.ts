import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {defaultActions} from '../packages/contracts/src/permissions.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,manager:any;
const api=(path:string,method='GET',body?:any,token=a.token,key=randomUUID())=>h.api(token,a.stores[0].id,path,method,body,key);
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard();manager=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'manager',name:'审核店长',password}));succeeded(await h.api(a.token,undefined,'/users/'+manager.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'manager'}]}));manager.token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'manager',password})).token;succeeded(await api('/permissions','PUT',{pages:{},actions:{manager:[...defaultActions.manager,'adjust','refund','reverseSettle']}}));succeeded(await api('/settings','POST',{approval_thresholds:JSON.stringify({inventory_adjustment:10,discount:10,refund:10})}));});after(()=>h.stop());
test('库存审批先提交，无扣库；本人/跨商家不能审核，另一管理员批准后只执行一次',async()=>{
 const item=succeeded(await api('/items','POST',{name:'审批商品',type:'product',price:20,cost:5,stock:10})),body={item_id:item.id,type:'loss',qty:3,remark:'破损报废'},key=randomUUID();
 const pending=await api('/inventory/move','POST',body,a.token,key);assert.equal(pending.status,202);assert.equal(pending.ok,false);assert.equal(pending.pending_approval,true);
 const again=await api('/inventory/move','POST',body);assert.equal(again.approval_id,pending.approval_id);assert.equal(succeeded(await api('/items')).find((i:any)=>i.id===item.id).stock,10);
 assert.equal((await api(`/approvals/${pending.approval_id}/review`,'POST',{status:'approved'})).status,403);
 assert.equal((await h.api(b.token,b.stores[0].id,`/approvals/${pending.approval_id}/review`,'POST',{status:'approved'})).status,404);
 succeeded(await api(`/approvals/${pending.approval_id}/review`,'POST',{status:'approved'},manager.token));
 assert.equal((await api('/inventory/move','POST',{...body,qty:4,approval_id:pending.approval_id})).status,409);
 const approved={...body,approval_id:pending.approval_id},executed=await Promise.all([api('/inventory/move','POST',approved,a.token,key),api('/inventory/move','POST',approved,a.token,key)]);executed.forEach(succeeded);assert.equal(executed[0].data.movement.id,executed[1].data.movement.id);assert.equal(executed[0].data.item.stock,7);
 assert.equal((await api('/inventory/move','POST',approved)).status,409);
 const stats=succeeded(await api('/inventory/overview'));assert.equal(stats.summary.loss_qty_today,3);assert.equal(stats.summary.loss_cost_today,15);
 const record=succeeded(await api('/approvals?status=all')).find((r:any)=>r.id===pending.approval_id);assert.equal(record.status,'consumed');assert.equal(JSON.parse(record.after_snapshot).execute.path,'/inventory/move');
});
test('盘点必须使用审核时的库存快照；执行失败回滚审批消费状态',async()=>{
 const item=succeeded(await api('/items','POST',{name:'盘点商品',type:'product',price:20,cost:5,stock:10}));
 const body={items:[{item_id:item.id,actual_qty:5,expected_stock:10}],remark:'盘亏核实'};const pending=await api('/inventory/count','POST',body);assert.equal(pending.status,202);succeeded(await api(`/approvals/${pending.approval_id}/review`,'POST',{status:'approved'},manager.token));
 succeeded(await api('/inventory/move','POST',{item_id:item.id,type:'in',qty:1,remark:'新增入库'}));
 assert.equal((await api('/inventory/count','POST',{...body,approval_id:pending.approval_id})).code,'STOCK_CHANGED');assert.equal(succeeded(await api('/approvals?status=approved')).find((r:any)=>r.id===pending.approval_id).status,'approved');
 const impossible={item_id:item.id,type:'out',qty:100,remark:'大额待核对出库'},p2=await api('/inventory/move','POST',impossible);assert.equal(p2.status,202);succeeded(await api(`/approvals/${p2.approval_id}/review`,'POST',{status:'approved'},manager.token));
 assert.equal((await api('/inventory/move','POST',{...impossible,approval_id:p2.approval_id})).code,'INSUFFICIENT_STOCK');assert.equal(succeeded(await api('/approvals?status=approved')).find((r:any)=>r.id===p2.approval_id).status,'approved');
 succeeded(await api(`/approvals/${pending.approval_id}/cancel`,'POST',{}));assert.equal((await api('/inventory/count','POST',{...body,approval_id:pending.approval_id})).status,409);
});
test('优惠与反结账审核绑定真实订单版本，改变操作或撤销原权限均不能执行',async()=>{
 const room=succeeded(await api('/rooms','POST',{room_no:'APPROVAL'})),product=succeeded(await api('/items','POST',{name:'优惠茶水',price:100,type:'product'}));let order=succeeded(await api('/sessions','POST',{resource_id:room.id}));order=succeeded(await api(`/sessions/${order.id}/items`,'POST',{catalog_id:product.id,version:order.version}));
 const discount={version:order.version,discount:20,reason:'顾客优惠'},pending=await api(`/sessions/${order.id}/discount`,'POST',discount,manager.token);assert.equal(pending.status,202);succeeded(await api(`/approvals/${pending.approval_id}/review`,'POST',{status:'approved'}));
 const approved=succeeded(await api(`/sessions/${order.id}/discount`,'POST',{...discount,approval_id:pending.approval_id},manager.token));assert.equal(approved.order.payable,80);
 order=succeeded(await api(`/sessions/${order.id}/checkout`,'POST',{version:approved.version,payments:[{method:'现金',amount:80}]}));
 const reversal={version:order.version,reason:'核对后重新结账'},refund=await api(`/sessions/${order.id}/reverse-checkout`,'POST',reversal,manager.token);assert.equal(refund.status,202);assert.equal(succeeded(await api('/orders/'+order.id)).status,'closed');succeeded(await api(`/approvals/${refund.approval_id}/review`,'POST',{status:'approved'}));
 succeeded(await api('/permissions','PUT',{pages:{},actions:{manager:defaultActions.manager}}));assert.equal((await api(`/sessions/${order.id}/reverse-checkout`,'POST',{...reversal,approval_id:refund.approval_id},manager.token)).status,403);assert.equal(succeeded(await api('/orders/'+order.id)).status,'closed');
});
