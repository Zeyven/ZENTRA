import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
import {businessDate,shiftDate} from '../apps/server/src/services/dates.js';
import {allocateDiscount} from '../apps/server/src/services/settlement.js';
import {calculatePrice} from '../apps/server/src/services/pricing-engine.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,floor:any,techUser:any;
const api=(path:string,method='GET',body?:any,key=randomUUID(),store=a.stores[0].id,token=a.token)=>h.api(token,store,path,method,body,key);
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard();floor=succeeded(await api('/users','POST',{username:'floor',name:'测试收银',password}));succeeded(await api('/users/'+floor.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'floor'}]}));floor.token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'floor',password})).token});
after(()=>h.stop());
test('integer-cent allocation preserves pennies without increasing discounts on free lines',()=>{
 assert.deepEqual(allocateDiscount([0.01,0.01,0.01],0.02),[0.01,0.01,0]);assert.deepEqual(allocateDiscount([0,1,2],1),[0,0.33,0.67]);assert.deepEqual(allocateDiscount([0,0],0),[0,0]);
});
test('price priority zero executes first and stop prevents lower-priority overrides',()=>{
 const result=calculatePrice({basePrice:100,context:{at:'2026-09-08 12:00',item_id:1},rules:[{id:1,priority:1,enabled:1,adjustment_type:'override',adjustment_value:99,stack_mode:'stop'},{id:2,priority:0,enabled:1,adjustment_type:'override',adjustment_value:80,stack_mode:'stop'}]});assert.equal(result.final_price,80);assert.deepEqual(result.applied_rules.map((r:any)=>r.id),[2]);
});
test('price rules validate calendar and cross-store identifiers, apply server-side, retain order price snapshots and reject stale edits',async()=>{
 const store=a.stores[0].id,item=succeeded(await api('/items','POST',{name:'定价茶水',type:'product',price:10.05,stock:10})),foreign=succeeded(await h.api(b.token,b.stores[0].id,'/items','POST',{name:'外店茶水',type:'product',price:1}));
 const body={name:'九折',item_id:item.id,adjustment_type:'percent',adjustment_value:-10,weekdays:[]};
 assert.equal((await api('/pricing-rules','POST',{...body,effective_from:'2026-02-30'})).status,400);
 assert.equal((await api('/pricing-rules','POST',{...body,item_id:foreign.id})).status,404);
 assert.equal((await api('/pricing-rules','POST',body,undefined,store,floor.token)).status,403);
 const key=randomUUID(),rule=succeeded(await api('/pricing-rules','POST',body,key));assert.equal(succeeded(await api('/pricing-rules','POST',body,key)).id,rule.id);
 assert.equal(succeeded(await api('/pricing-rules/preview','POST',{item_id:item.id})).final_price,9.05);
 assert.equal((await api('/pricing-rules/preview','POST',{item_id:item.id,member_id:99999999})).status,404);
 const room=succeeded(await api('/rooms','POST',{room_no:'PRICING'}));let order=succeeded(await api('/sessions','POST',{resource_id:room.id}));order=succeeded(await api('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id}));assert.equal(order.order.payable,9.05);
 const changed=succeeded(await api('/pricing-rules','POST',{...body,id:rule.id,version:rule.version,adjustment_value:0}));assert.equal(changed.version,2);
 assert.equal((await api('/pricing-rules','POST',{...body,id:rule.id,version:rule.version})).status,409);
 assert.equal(succeeded(await api('/orders/'+order.id)).items[0].price,9.05);
 succeeded(await api('/pricing-rules/'+changed.id,'DELETE',{version:changed.version,reason:'停止测试价格'}));
});
test('daily, payment, member, cashier and profit reports reconcile posted money and exact reversals without changing past item costs',async()=>{
 const today=businessDate(),store=a.stores[1].id,call=(p:string,m='GET',body?:any)=>api(p,m,body,undefined,store);
 const room=succeeded(await call('/rooms','POST',{room_no:'CROSSDAY'})),product=succeeded(await call('/items','POST',{name:'测试商品',type:'product',price:10.01,cost:2,stock:10})),member=succeeded(await call('/members','POST',{name:'储值会员'}));
 succeeded(await call('/members/recharge','POST',{customer_id:member.id,amount:100,gift_amount:10,method:'微信'}));
 let order=succeeded(await call('/sessions','POST',{resource_id:room.id,deposit:30,customer_id:member.id}));
 order=succeeded(await call('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:product.id,quantity:3}));
 order=succeeded(await call('/sessions/'+order.id+'/discount','POST',{version:order.version,discount:0.01,reason:'抹分'}));
 await inTenant(a.merchant.id,()=>tenantQuery('UPDATE orders SET opened_at=$1 WHERE id=$2 AND store_id=$3',[shiftDate(today,-1)+'T23:59:00+08:00',order.id,store]));
 order=succeeded(await call('/sessions/'+order.id+'/checkout','POST',{version:order.version,payments:[{method:'现金',amount:10.02},{method:'会员卡',amount:20}]}));
 const report=succeeded(await call('/reports/daily?date='+today));assert.equal(report.sales.total_sales,30.03);assert.equal(report.sales.total_discount,0.01);assert.equal(report.sales.total_payable,30.02);assert.equal(report.sales.customer_flow,0);assert.equal(report.rechargeTotal,100);assert.equal(report.depositCollected,30);assert.equal(report.channel.会员,20);assert.equal(report.channel.线下,10.02);
 assert.equal(succeeded(await call('/reports/daily?date='+shiftDate(today,-1))).sales.total_payable,0);
 const members=succeeded(await call('/reports/members'));assert.equal(members.list.find((m:any)=>m.id===member.id).consume,20);assert.equal(members.list.find((m:any)=>m.id===member.id).principal_used,20);
 assert.equal(succeeded(await call('/reports/cashiers')).list[0].revenue,30.02);
 const profit=succeeded(await call('/reports/profit'));assert.equal(profit.summary.revenue,30.02);assert.equal(profit.summary.material,6);assert.equal(profit.summary.profit,24.02);
 await inTenant(a.merchant.id,()=>tenantQuery('UPDATE items SET cost=99 WHERE id=$1',[product.id]));assert.deepEqual(succeeded(await call('/reports/profit')).summary,profit.summary);
 order=succeeded(await call('/sessions/'+order.id+'/refund-deposit','POST',{version:order.version,reason:'退押金'}));
 order=succeeded(await call('/sessions/'+order.id+'/reverse-checkout','POST',{version:order.version,reason:'原路冲回'}));
 const after=succeeded(await call('/reports/daily'));assert.equal(after.sales.total_payable,0);assert.equal(after.refundTotal,30.02);assert.equal(after.depositRefunded,30);assert(after.payStats.every((p:any)=>p.amount===0));assert.equal(after.itemStats[0].cnt,0);
 assert.equal(succeeded(await call('/reports/profit')).summary.profit,0);assert.equal(succeeded(await call('/reports/members')).list.find((m:any)=>m.id===member.id).consume,0);
 await assert.rejects(inTenant(a.merchant.id,()=>tenantQuery('UPDATE settlement_lines SET gross_amount=0 WHERE store_id=$1',[store])),(e:any)=>e.code==='42501');
});
test('own technician earnings include completed unpaid service, rule matching uses quantity, and payroll stays locked through rule changes and retries',async()=>{
 const tech=succeeded(await api('/technicians','POST',{name:'提成技师',code:'T01',base_salary:1000,commission_rate:10})),other=succeeded(await api('/technicians','POST',{name:'其他技师',code:'T02',base_salary:9999}));
 succeeded(await api('/technicians/'+tech.id+'/clock','POST',{status:'on'}));
 techUser=succeeded(await api('/users','POST',{username:'tech',name:'测试技师账号',password}));succeeded(await api('/users/'+techUser.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'technician',technician_id:tech.id}]}));techUser.token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'tech',password})).token;
 const item=succeeded(await api('/items','POST',{name:'提成服务',type:'service',price:100,duration:60})),room=succeeded(await api('/rooms','POST',{room_no:'PAYROLL'}));let order=succeeded(await api('/sessions','POST',{resource_id:room.id}));order=succeeded(await api('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id,quantity:2,technician_id:tech.id}));
 const clock=succeeded(await api('/clocks')).clocks.find((c:any)=>c.order_id===order.id);succeeded(await api('/clocks/'+clock.id+'/finish','POST',{expected_version:clock.order_version,reason:'服务完成'}));
 const body={name:'两钟阶梯',conditions:{technician_ids:[tech.id],item_ids:[item.id],min_count:2},action_type:'fixed',action_value:30},rule=succeeded(await api('/commission-rules','POST',body));
 const own=succeeded(await api('/reports/technicians','GET',undefined,undefined,a.stores[0].id,techUser.token));assert.equal(own.list.length,1);assert.equal(own.list[0].id,tech.id);assert.equal(own.list[0].commission,60);assert.equal(own.list[0].served_count,2);assert.equal(succeeded(await api('/orders/'+order.id)).status,'open');
 const month=businessDate().slice(0,7),key=randomUUID();const locks=await Promise.all([api('/payroll/'+month+'/lock','POST',{reason:'核算测试'},key),api('/payroll/'+month+'/lock','POST',{reason:'核算测试'},key)]);locks.forEach(succeeded);assert.deepEqual(locks[0].data,locks[1].data);assert.equal(locks[0].data.list.find((t:any)=>t.id===tech.id).salary,1060);
 succeeded(await api('/commission-rules','POST',{...body,id:rule.id,version:rule.version,action_value:99}));
 assert.equal(succeeded(await api('/reports/salaries?month='+month)).list.find((t:any)=>t.id===tech.id).salary,1060);
 assert.equal(succeeded(await api('/reports/technicians')).list.find((t:any)=>t.id===tech.id).commission,198);
 const preview=succeeded(await api('/commission-rules/preview','POST',{lines:[{id:1,technician_id:tech.id,item_id:item.id,quantity:2,amount:200,clock_out_at:new Date().toISOString(),service_type:'轮钟'}]}));assert.equal(preview.total,198);
 assert.equal((await h.api(b.token,b.stores[0].id,'/commission-rules/preview','POST',{lines:[{id:1,technician_id:tech.id,item_id:item.id,quantity:2,amount:200,clock_out_at:new Date().toISOString(),service_type:'轮钟'}]})).status,404);
 succeeded(await api('/commission-rules/'+rule.id,'DELETE',{version:rule.version+1,reason:'测试规则停用'}));assert.equal(succeeded(await api('/reports/technicians')).list.find((t:any)=>t.id===tech.id).commission,20);assert.equal(succeeded(await api('/reports/salaries?month='+month)).list.find((t:any)=>t.id===tech.id).salary,1060);
 const snapshot=await inTenant(a.merchant.id,async()=>(await tenantQuery('SELECT calculation_detail FROM payroll_snapshots WHERE store_id=$1 AND month=$2 AND technician_id=$3',[a.stores[0].id,month,tech.id])).rows[0]);assert.equal(JSON.parse(snapshot.calculation_detail).calculation_snapshot.rules[0].action_value,30);
 assert.equal(other.id===tech.id,false);
});
test('all financial report routes reject employee/technician escalation and cross-store context, and empty months can be locked',async()=>{
 for(const path of ['/reports/daily','/reports/members','/reports/cashiers','/reports/verifications','/reports/rooms','/reports/salaries','/reports/monthly','/reports/flow','/reports/analysis','/reports/profit','/reports/growth','/reports/executive-brief','/payroll/2026-08']){
  succeeded(await api(path));
  assert.equal((await api(path,'GET',undefined,undefined,a.stores[0].id,floor.token)).status,403,path);
  assert.equal((await api(path,'GET',undefined,undefined,a.stores[0].id,techUser.token)).status,403,path);
  assert.equal((await h.api(b.token,a.stores[0].id,path)).status,403,path);
 }
 assert.equal((await api('/reports/daily?start_date=2026-02-30')).status,400);assert.equal((await api('/reports/salaries?month=2026-13')).status,400);assert.equal((await api('/reports/daily?start_date=2024-01-01&end_date=2026-01-01')).status,400);
 const isolated=succeeded(await h.api(b.token,b.stores[0].id,'/reports/daily'));assert.equal(isolated.sales.total_payable,0);assert.equal(isolated.payStats.length,0);
 const locked=succeeded(await h.api(b.token,b.stores[0].id,'/payroll/2026-08/lock','POST',{reason:'空月份核算'}));assert.equal(locked.locked,true);assert.deepEqual(locked.list,[]);assert.equal(succeeded(await h.api(b.token,b.stores[0].id,'/payroll/2026-08')).locked,true);
});
test('growth joins real coupon redemptions without double counting order revenue; reversals remove current conversion value',async()=>{
 const store=b.stores[1].id,call=(path:string,method='GET',body?:any)=>h.api(b.token,store,path,method,body);
 const item=succeeded(await call('/items','POST',{name:'营销服务商品',type:'product',price:100})),room=succeeded(await call('/rooms','POST',{room_no:'GROWTH'}));let order=succeeded(await call('/sessions','POST',{resource_id:room.id}));order=succeeded(await call('/sessions/'+order.id+'/items','POST',{version:order.version,catalog_id:item.id}));
 const coupons=[];for(let i=0;i<2;i++){const coupon=succeeded(await call('/coupons','POST',{name:'回访券'+i,value:10,type:'cash'}));coupons.push(coupon);order=succeeded(await call('/coupons/'+coupon.id+'/use','POST',{order_id:order.id,version:order.version}))}
 order=succeeded(await call('/sessions/'+order.id+'/checkout','POST',{version:order.version,payments:[{method:'现金',amount:80}]}));
 // Workflow delivery fixtures are test-only; the sales, discounts and payments above use the real business API.
 await inTenant(b.merchant.id,async()=>{
  for(const [index,coupon] of coupons.entries()){
   const workflow=(await tenantQuery("INSERT INTO marketing_workflows(store_id,name,trigger_type,coupon_name,coupon_value,enabled) VALUES($1,$2,$3,$4,10,0) RETURNING id",[store,'回访活动'+index,index===0?'birthday':'dormant',coupon.name])).rows[0];
   await tenantQuery("INSERT INTO marketing_outbox(store_id,workflow_id,trigger_key,scheduled_at,status,coupon_id) VALUES($1,$2,$3,now(),'issued',$4)",[store,workflow.id,'delivery',coupon.id]);
  }
 });
 const report=succeeded(await call('/reports/growth'));assert.equal(report.campaigns.length,2);assert.equal(report.marketing.issued_count,2);assert.equal(report.marketing.used_count,2);assert.equal(report.marketing.attributed_revenue,80);assert.equal(report.marketing.discount_amount,20);assert.equal(report.marketing.roi,3);assert(report.campaigns.every((r:any)=>r.attributed_revenue===40));
 const brief=succeeded(await call('/reports/executive-brief'));assert.equal(brief.kpis.revenue,80);assert.equal(brief.kpis.orders,1);assert.equal(brief.kpis.low_stock,0);
 succeeded(await call('/sessions/'+order.id+'/reverse-checkout','POST',{version:order.version,reason:'营销订单核对后冲销'}));assert.equal(succeeded(await call('/reports/growth')).marketing.attributed_revenue,0);assert.equal(succeeded(await call('/reports/executive-brief')).kpis.revenue,0);
 assert.equal(succeeded(await api('/reports/growth')).campaigns.length,0);
});
