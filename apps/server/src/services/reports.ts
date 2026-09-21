import {Decimal} from 'decimal.js';
import {tenantQuery} from '../db/pools.js';
import {money,sum} from '../business.js';
import {dateRange,shiftDate} from './dates.js';
type Range=ReturnType<typeof dateRange>;
export const rangeMetadata=(range:Range)=>({start_date:range.start,end_date:range.end,time_zone:'Asia/Shanghai',accounting_basis:'posted_ledger'});
export async function ledgerTotals(storeId:number,range:Range){return (await tenantQuery(`SELECT
 coalesce(sum(amount) FILTER(WHERE kind IN('sale','sale_reversal')),0) AS total_sales,
 coalesce(sum(amount) FILTER(WHERE kind IN('discount','discount_reversal')),0) AS total_discount,
 count(*) FILTER(WHERE kind='sale') AS order_count,count(*) FILTER(WHERE kind='sale_reversal') AS reversal_count,
 coalesce(sum(amount) FILTER(WHERE kind IN('payment','payment_reversal')),0) AS payment_net,
 coalesce(-sum(amount) FILTER(WHERE kind='payment_reversal'),0) AS refund_total,
 coalesce(sum(amount) FILTER(WHERE kind IN('recharge','recharge_reversal')),0) AS recharge_total,
 coalesce(sum(amount) FILTER(WHERE kind='deposit'),0) AS deposit_collected,
 coalesce(-sum(amount) FILTER(WHERE kind='deposit_refund'),0) AS deposit_refunded,
 coalesce(sum(amount) FILTER(WHERE kind IN('booking_deposit','booking_refund')),0) AS booking_deposit_net,
 coalesce(sum(amount) FILTER(WHERE method IS NOT NULL AND method!='会员卡'),0) AS external_net
 FROM shift_entries WHERE store_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`,[storeId,range.from,range.until])).rows[0]}
export async function paymentStats(storeId:number,range:Range){return (await tenantQuery(`SELECT method,count(*) FILTER(WHERE kind='payment') AS cnt,
 coalesce(sum(amount) FILTER(WHERE kind='payment'),0) AS received,coalesce(-sum(amount) FILTER(WHERE kind='payment_reversal'),0) AS refunded,sum(amount) AS amount
 FROM shift_entries WHERE store_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz AND kind IN('payment','payment_reversal') GROUP BY method ORDER BY amount DESC,method`,[storeId,range.from,range.until])).rows}
export async function itemStats(storeId:number,range:Range){return (await tenantQuery(`SELECT l.item_id,l.item_name,l.item_type,sum(l.quantity) AS cnt,sum(l.gross_amount) AS amount,sum(l.discount_amount) AS discount_allocated,
 sum(l.gross_amount-l.discount_amount) AS net_revenue,sum(l.standard_commission) AS commission_cost,sum(l.standard_material) AS material_cost
 FROM settlement_lines l JOIN shift_entries e ON e.merchant_id=l.merchant_id AND e.id=l.entry_id WHERE l.store_id=$1 AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz
 GROUP BY l.item_id,l.item_name,l.item_type ORDER BY amount DESC,l.item_id`,[storeId,range.from,range.until])).rows}
export async function dailyReport(storeId:number,range:Range){
 const totals=await ledgerTotals(storeId,range),prior=dateRange({start_date:shiftDate(range.start,-range.days),end_date:shiftDate(range.start,-1)}),previous=await ledgerTotals(storeId,prior);
 const arrivals=(await tenantQuery(`SELECT count(*) FILTER(WHERE status IN('open','suspended')) AS open_count,count(*) FILTER(WHERE status!='cancelled') AS customer_flow FROM orders WHERE store_id=$1 AND opened_at >= $2::timestamptz AND opened_at < $3::timestamptz`,[storeId,range.from,range.until])).rows[0];
 const totalPayable=money(new Decimal(totals.total_sales).minus(totals.total_discount)),prevPayable=money(new Decimal(previous.total_sales).minus(previous.total_discount));
 const payStats=await paymentStats(storeId,range),channel:Record<string,number>={团购:0,会员:0,线下:0};
 for(const row of payStats){const key=['美团','抖音'].includes(row.method)?'团购':row.method==='会员卡'?'会员':'线下';channel[key]=money(new Decimal(channel[key]).plus(row.amount))}
 return {...rangeMetadata(range),date:range.start,sales:{...totals,...arrivals,total_payable:totalPayable,avg_price:totals.order_count?money(new Decimal(totalPayable).div(totals.order_count)):0},channel,payStats,itemStats:await itemStats(storeId,range),
  compare:{prev_start:prior.start,prev_end:prior.end,prev_payable:prevPayable,prev_orders:previous.order_count,payable_change:money(new Decimal(totalPayable).minus(prevPayable)),payable_change_pct:prevPayable>0?money(new Decimal(totalPayable).minus(prevPayable).div(prevPayable).mul(100)):null},
  rechargeTotal:totals.recharge_total,refundTotal:totals.refund_total,depositCollected:totals.deposit_collected,depositRefunded:totals.deposit_refunded};
}
export async function dailyTrend(storeId:number,range:Range){return (await tenantQuery(`SELECT to_char(d.day,'YYYY-MM-DD') AS day,coalesce(e.revenue,0) AS revenue,coalesce(e.orders,0) AS orders,coalesce(e.reversals,0) AS reversals FROM generate_series($2::date,$3::date,interval '1 day') d(day)
 LEFT JOIN (SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
 sum(CASE WHEN kind IN('sale','sale_reversal') THEN amount WHEN kind IN('discount','discount_reversal') THEN -amount ELSE 0 END) AS revenue,
 count(*) FILTER(WHERE kind='sale') AS orders,count(*) FILTER(WHERE kind='sale_reversal') AS reversals FROM shift_entries WHERE store_id=$1 AND created_at >= $4::timestamptz AND created_at < $5::timestamptz GROUP BY day) e ON e.day=d.day::date ORDER BY d.day`,[storeId,range.start,range.end,range.from,range.until])).rows}
export async function memberReport(storeId:number,range:Range){
 const list=(await tenantQuery(`SELECT m.id,m.name,m.phone,m.card_no,m.level,m.created_at,m.balance,m.bonus_balance,m.times_balance,m.points,m.store_id AS registration_store_id,
 coalesce(a.recharge,0) AS recharge,coalesce(a.consume,0) AS consume,coalesce(a.principal_used,0) AS principal_used,coalesce(a.bonus_used,0) AS bonus_used,coalesce(a.times_used,0) AS times_used,
 coalesce(v.order_count,0) AS order_count,v.last_visit,
 CASE WHEN v.last_visit IS NULL OR v.last_visit < $3::timestamptz - interval '60 days' THEN '流失' WHEN v.last_visit < $3::timestamptz - interval '30 days' THEN '沉睡' WHEN v.order_count>=5 THEN '核心' WHEN v.order_count>=2 THEN '复购' ELSE '潜力' END AS rfm_tag
 FROM members m JOIN merchants t ON t.id=m.merchant_id
 LEFT JOIN (SELECT x.member_id,sum(CASE WHEN x.type='recharge' THEN x.funded_amount WHEN original.type='recharge' THEN -original.funded_amount ELSE 0 END) AS recharge,
 -sum(CASE WHEN x.type='consume' OR original.type='consume' THEN x.principal+x.bonus ELSE 0 END) AS consume,
 -sum(CASE WHEN x.type='consume' OR original.type='consume' THEN x.principal ELSE 0 END) AS principal_used,
 -sum(CASE WHEN x.type='consume' OR original.type='consume' THEN x.bonus ELSE 0 END) AS bonus_used,
 -sum(CASE WHEN x.type='consume' OR original.type='consume' THEN x.times ELSE 0 END) AS times_used
 FROM asset_operations x LEFT JOIN asset_operations original ON original.merchant_id=x.merchant_id AND original.id=x.reversal_of
 WHERE x.store_id=$1 AND x.created_at >= $2::timestamptz AND x.created_at < $3::timestamptz GROUP BY x.member_id) a ON a.member_id=m.id
 LEFT JOIN (SELECT member_id,count(*) AS order_count,max(closed_at) AS last_visit FROM orders WHERE store_id=$1 AND status='closed' AND closed_at<$3::timestamptz GROUP BY member_id) v ON v.member_id=m.id
 WHERE (m.store_id=$1 OR t.member_mode='merchant') AND m.status!='archived' ORDER BY recharge DESC,m.id`,[storeId,range.from,range.until])).rows;
 const rfm:Record<string,number>={核心:0,复购:0,潜力:0,沉睡:0,流失:0};for(const m of list)rfm[m.rfm_tag]++;
 const repeat=list.filter(m=>m.order_count>=2).length;
 return {...rangeMetadata(range),list,summary:{total:list.length,new_count:list.filter(m=>new Date(m.created_at).getTime()>=Date.parse(range.from)&&new Date(m.created_at).getTime()<Date.parse(range.until)).length,repeat_count:repeat,repeat_rate:list.length?money(new Decimal(repeat).div(list.length).mul(100)):0,sleep_count:rfm.沉睡+rfm.流失,rfm}};
}
export async function roomReport(storeId:number,range:Range){
 const list=(await tenantQuery(`SELECT r.id,r.room_no,r.room_name,r.status,coalesce(o.used_count,0) AS used_count,coalesce(o.avg_minutes,0) AS avg_minutes,coalesce(e.revenue,0) AS revenue FROM rooms r
 LEFT JOIN (SELECT room_id,count(*) AS used_count,round(avg(extract(epoch FROM closed_at-opened_at)/60)) AS avg_minutes FROM orders WHERE store_id=$1 AND status!='cancelled' AND opened_at >= $2::timestamptz AND opened_at < $3::timestamptz GROUP BY room_id) o ON o.room_id=r.id
 LEFT JOIN (SELECT x.room_id,sum(CASE WHEN e.kind IN('sale','sale_reversal') THEN e.amount WHEN e.kind IN('discount','discount_reversal') THEN -e.amount ELSE 0 END) AS revenue FROM shift_entries e JOIN orders x ON x.merchant_id=e.merchant_id AND x.id=e.order_id WHERE e.store_id=$1 AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz GROUP BY x.room_id) e ON e.room_id=r.id
 WHERE r.store_id=$1 AND (r.active=1 OR o.used_count>0 OR e.revenue<>0) ORDER BY used_count DESC,r.id`,[storeId,range.from,range.until])).rows;
 const used=list.reduce((n,r)=>n+r.used_count,0);return {...rangeMetadata(range),list,summary:{total_rooms:list.length,total_used:used,avg_turnover:list.length?money(new Decimal(used).div(list.length)):0}};
}
export async function cashierReport(storeId:number,range:Range){
 const list=(await tenantQuery(`SELECT u.id,u.name,u.username,count(*) FILTER(WHERE e.kind='sale') AS order_count,count(*) FILTER(WHERE e.kind='sale_reversal') AS reversal_count,
 coalesce(sum(e.amount) FILTER(WHERE e.kind IN('payment','payment_reversal')),0) AS revenue,
 coalesce(sum(e.amount) FILTER(WHERE e.kind IN('discount','discount_reversal')),0) AS discount_total,
 coalesce(-sum(e.amount) FILTER(WHERE e.kind='payment_reversal'),0) AS refund_total
 FROM merchant_users u JOIN shift_entries e ON e.merchant_id=u.merchant_id AND e.cashier_id=u.id WHERE e.store_id=$1 AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz GROUP BY u.id ORDER BY revenue DESC,u.id`,[storeId,range.from,range.until])).rows;
 const pay=(await tenantQuery(`SELECT cashier_id,method,sum(amount) AS amount FROM shift_entries WHERE store_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz AND kind IN('payment','payment_reversal') GROUP BY cashier_id,method ORDER BY method`,[storeId,range.from,range.until])).rows;
 return {...rangeMetadata(range),list:list.map(row=>({...row,payments:pay.filter(p=>p.cashier_id===row.id).map(({cashier_id,...p})=>p)}))};
}
export async function verificationReport(storeId:number,range:Range){
 const rows=(await tenantQuery(`SELECT e.id,e.kind,p.id AS payment_id,e.method,abs(e.amount) AS amount,p.voucher_code,e.created_at AS paid_at,e.created_at AS refund_at,o.order_no,o.customer_name FROM shift_entries e
 JOIN payments p ON p.merchant_id=e.merchant_id AND p.id=e.payment_id JOIN orders o ON o.merchant_id=e.merchant_id AND o.id=e.order_id
 WHERE e.store_id=$1 AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz AND e.kind IN('payment','payment_reversal') AND p.voucher_code IS NOT NULL AND p.voucher_code!='' ORDER BY e.id DESC`,[storeId,range.from,range.until])).rows;
 const list=rows.filter(r=>r.kind==='payment'),refunds=rows.filter(r=>r.kind==='payment_reversal');const methods=new Map<string,{method:string;cnt:number;amount:number}>();
 for(const r of list){const item=methods.get(r.method)??{method:r.method,cnt:0,amount:0};item.cnt++;item.amount=money(new Decimal(item.amount).plus(r.amount));methods.set(r.method,item)}
 return {...rangeMetadata(range),date:range.start,list,refunds,summary:[...methods.values()],refundTotal:money(sum(refunds.map(r=>r.amount)))};
}
