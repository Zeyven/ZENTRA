import {Router} from 'express';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {merchantRoute,audit,event} from '../access.js';
import {context,tenantQuery} from '../db/pools.js';
import {Id,input,idempotent,money,sum} from '../business.js';
import {ensure} from '../errors.js';
import {businessDate,dateRange,monthRange,shiftDate} from '../services/dates.js';
import {technicianEarnings} from '../services/earnings.js';
import {dailyReport,dailyTrend,paymentStats,itemStats,memberReport,roomReport,cashierReport,verificationReport,rangeMetadata,ledgerTotals} from '../services/reports.js';
export const reportsRouter=Router();
const read={store:true,roles:['manager'],support:'read' as const,snapshot:true};
reportsRouter.get('/reports/entries',merchantRoute(read,async(req,a)=>{
 const range=dateRange(req.query),before=req.query.before?Id.parse(req.query.before):null;
 const rows=(await tenantQuery(`SELECT e.id,e.created_at,e.kind,e.method,e.amount,e.order_id,e.shift_id,e.reversal_of,e.reason,o.order_no,u.name AS operator_name
 FROM shift_entries e LEFT JOIN orders o ON o.merchant_id=e.merchant_id AND o.store_id=e.store_id AND o.id=e.order_id
 LEFT JOIN merchant_users u ON u.merchant_id=e.merchant_id AND u.id=e.cashier_id
 WHERE e.store_id=$1 AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz AND ($4::bigint IS NULL OR e.id<$4)
 ORDER BY e.id DESC LIMIT 101`,[a.storeId,range.from,range.until,before])).rows;
 return {...rangeMetadata(range),rows:rows.slice(0,100),next:rows.length>100?rows[99].id:null};
}));
reportsRouter.get('/reports/daily',merchantRoute(read,async(req,a)=>dailyReport(a.storeId!,dateRange(req.query))));
reportsRouter.get('/reports/members',merchantRoute(read,async(req,a)=>memberReport(a.storeId!,dateRange(req.query))));
reportsRouter.get('/reports/rooms',merchantRoute(read,async(req,a)=>roomReport(a.storeId!,dateRange(req.query))));
reportsRouter.get('/reports/cashiers',merchantRoute(read,async(req,a)=>cashierReport(a.storeId!,dateRange(req.query))));
reportsRouter.get('/reports/verifications',merchantRoute(read,async(req,a)=>verificationReport(a.storeId!,dateRange(req.query))));
reportsRouter.get('/reports/monthly',merchantRoute(read,async(req,a)=>dailyTrend(a.storeId!,monthRange(req.query.month))));
reportsRouter.get('/reports/technicians',merchantRoute({...read,roles:['manager','technician']},async(req,a)=>{
 const range=dateRange(req.query);if(a.role==='technician')ensure(a.technicianId,409,'TECHNICIAN_REQUIRED','账号尚未关联技师档案');
 const list=await technicianEarnings(a.storeId!,range,a.role==='technician'?a.technicianId:undefined);
 return {...rangeMetadata(range),accounting_basis:'completed_service',list:list.map(({calculation_snapshot,...row}:any)=>row)};
}));
async function payrollSnapshot(storeId:number,month:string){
 const period=(await tenantQuery('SELECT month,locked_at,locked_by,reason FROM payroll_periods WHERE store_id=$1 AND month=$2',[storeId,month])).rows[0];
 const rows=period?(await tenantQuery('SELECT calculation_detail FROM payroll_snapshots WHERE store_id=$1 AND month=$2 ORDER BY technician_id',[storeId,month])).rows:[];
 return {month,locked:!!period,period:period??null,list:rows.map(r=>{const {calculation_snapshot,...row}=JSON.parse(r.calculation_detail);return row})};
}
reportsRouter.get('/payroll/:month',merchantRoute(read,async(req,a)=>payrollSnapshot(a.storeId!,monthRange(req.params.month).month)));
reportsRouter.get('/reports/salaries',merchantRoute(read,async(req,a)=>{
 const range=monthRange(req.query.month),saved=await payrollSnapshot(a.storeId!,range.month);
 if(saved.locked)return saved;
 const rows=await technicianEarnings(a.storeId!,range);return {month:range.month,locked:false,list:rows.map(({calculation_snapshot,...row}:any)=>row)};
}));
reportsRouter.post('/payroll/:month/lock',merchantRoute({store:true,write:true,roles:['manager']},async(req,a)=>idempotent(req,'payroll.lock:'+req.params.month,async()=>{
 const range=monthRange(req.params.month),body=z.object({reason:z.string().trim().min(1).max(500)}).strict().parse(input(req));
 await tenantQuery('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`payroll:${context().merchantId}:${a.storeId}:${range.month}`]);
 const existing=await payrollSnapshot(a.storeId!,range.month);if(existing.locked)return existing;
 const rows=await technicianEarnings(a.storeId!,range);
 await tenantQuery('INSERT INTO payroll_periods(store_id,month,locked_by,reason) VALUES($1,$2,$3,$4)',[a.storeId,range.month,a.user.id,body.reason]);
 for(const row of rows)await tenantQuery(`INSERT INTO payroll_snapshots(store_id,month,technician_id,base_salary,commission,bonus,total_salary,calculation_detail,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'locked',$9)`,[a.storeId,range.month,row.id,row.base_salary,row.commission,row.dianzhong_bonus_total,row.salary,JSON.stringify(row),a.user.id]);
 await audit('payroll.locked',{month:range.month,count:rows.length,reason:body.reason},'payroll',range.month);await event('payroll.changed',range.month);return payrollSnapshot(a.storeId!,range.month);
})));
reportsRouter.get('/reports/flow',merchantRoute(read,async(req,a)=>{
 const range=dateRange(req.query),unit=range.start===range.end?'HH24':'YYYY-MM-DD';
 const list=(await tenantQuery(`SELECT to_char(opened_at AT TIME ZONE 'Asia/Shanghai',$4) AS bucket,count(*) AS cnt,coalesce(sum(payable) FILTER(WHERE status='closed'),0) AS revenue FROM orders WHERE store_id=$1 AND opened_at >= $2::timestamptz AND opened_at < $3::timestamptz AND status!='cancelled' GROUP BY bucket ORDER BY bucket`,[a.storeId,range.from,range.until,unit])).rows.map(({bucket,...row})=>({...row,...(range.start===range.end?{hour:bucket}:{day:bucket}),avg_price:row.cnt?money(new Decimal(row.revenue).div(row.cnt)):0}));
 return {...rangeMetadata(range),accounting_basis:'arrival_orders',list};
}));
reportsRouter.get('/reports/analysis',merchantRoute(read,async(req,a)=>{
 const days=z.coerce.number().int().min(7).max(30).parse(req.query.days||14),end=businessDate(),range=dateRange({start_date:shiftDate(end,-days+1),end_date:end}),month=dateRange({start_date:shiftDate(end,-29),end_date:end});
 const trend=await dailyTrend(a.storeId!,range),items=await itemStats(a.storeId!,month),technicians=await technicianEarnings(a.storeId!,month);
 const members=(await tenantQuery(`SELECT count(*) AS total,count(*) FILTER(WHERE m.created_at >= $2::timestamptz) AS new_30d,count(*) FILTER(WHERE m.balance>0 OR m.bonus_balance>0 OR m.times_balance>0) AS active_balance FROM members m JOIN merchants t ON t.id=m.merchant_id WHERE (m.store_id=$1 OR t.member_mode='merchant') AND m.status!='archived'`,[a.storeId,month.from])).rows[0];
 const counts=(await tenantQuery("SELECT (SELECT count(*) FROM rooms WHERE store_id=$1 AND active=1) AS room_count,(SELECT count(*) FROM technicians WHERE store_id=$1 AND active=1) AS tech_count",[a.storeId])).rows[0];
 const revenue=money(sum(trend.map(d=>d.revenue))),orders=trend.reduce((n,d)=>n+d.orders,0);
 return {days,trend,itemTop:items.slice(0,10),techTop:technicians.sort((a:any,b:any)=>b.service_amount-a.service_amount).slice(0,10).map((t:any)=>({id:t.id,name:t.name,code:t.code,cnt:t.served_count,amount:t.service_amount})),payShare:await paymentStats(a.storeId!,month),memberStat:members,
 efficiency:{...counts,closed_orders:orders,turnover_rate:counts.room_count?money(new Decimal(orders).div(counts.room_count)):0,revenue_n:revenue,avg_revenue_per_tech:counts.tech_count?money(new Decimal(revenue).div(counts.tech_count)):0}};
}));
reportsRouter.get('/reports/profit',merchantRoute(read,async(req,a)=>{
 const range=dateRange(req.query),rows=await itemStats(a.storeId!,range);const list=rows.map(r=>{const profit=money(new Decimal(r.net_revenue).minus(r.commission_cost).minus(r.material_cost));return {...r,sales_count:r.cnt,gross_revenue:r.amount,contribution_profit:profit,margin:r.net_revenue>0?money(new Decimal(profit).div(r.net_revenue).mul(100)):0}});
 return {...rangeMetadata(range),cost_basis:'settlement_standard_snapshot',is_actual_profit:false,list,summary:{revenue:money(sum(list.map(r=>r.net_revenue))),commission:money(sum(list.map(r=>r.commission_cost))),material:money(sum(list.map(r=>r.material_cost))),profit:money(sum(list.map(r=>r.contribution_profit)))}};
}));
reportsRouter.get('/reports/growth',merchantRoute(read,async(req,a)=>{
 const range=dateRange(req.query),statuses=(await tenantQuery('SELECT status,count(*) AS count FROM booking_waitlist WHERE store_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz GROUP BY status',[a.storeId,range.from,range.until])).rows;
 const waitlist:Record<string,number>={total:0,waiting:0,offered:0,converted:0,expired:0,cancelled:0,conversion_rate:0,offer_accept_rate:0};for(const row of statuses){waitlist.total+=row.count;waitlist[row.status]=row.count}
 waitlist.conversion_rate=waitlist.total?money(new Decimal(waitlist.converted).div(waitlist.total).mul(100)):0;const offered=waitlist.offered+waitlist.converted+waitlist.expired;waitlist.offer_accept_rate=offered?money(new Decimal(waitlist.converted).div(offered).mul(100)):0;
 const campaigns=(await tenantQuery(`WITH cohort AS (SELECT * FROM marketing_outbox WHERE store_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz),
 issued AS (SELECT DISTINCT workflow_id,coupon_id FROM cohort WHERE coupon_id IS NOT NULL),
 attribution AS (SELECT c.used_order_id,count(DISTINCT c.id) AS coupons FROM coupons c JOIN orders o ON o.merchant_id=c.merchant_id AND o.id=c.used_order_id AND o.status='closed' WHERE c.store_id=$1 AND c.status='used' AND EXISTS(SELECT 1 FROM marketing_outbox b WHERE b.merchant_id=c.merchant_id AND b.coupon_id=c.id) GROUP BY c.used_order_id),
 totals AS (SELECT i.workflow_id,count(*) AS issued_count,count(*) FILTER(WHERE c.status='used' AND o.status='closed') AS used_count,
 coalesce(sum(c.used_discount_amount) FILTER(WHERE c.status='used' AND o.status='closed'),0) AS discount_amount,
 coalesce(sum(o.payable/at.coupons) FILTER(WHERE c.status='used' AND o.status='closed'),0) AS attributed_revenue
 FROM issued i JOIN coupons c ON c.id=i.coupon_id AND c.store_id=$1 LEFT JOIN orders o ON o.merchant_id=c.merchant_id AND o.id=c.used_order_id LEFT JOIN attribution at ON at.used_order_id=c.used_order_id GROUP BY i.workflow_id)
 SELECT w.id,w.name,w.trigger_type,w.channel,(SELECT count(*) FROM cohort b WHERE b.workflow_id=w.id) AS triggered_count,
 coalesce(t.issued_count,0) AS issued_count,coalesce(t.used_count,0) AS used_count,coalesce(t.discount_amount,0) AS discount_amount,coalesce(t.attributed_revenue,0) AS attributed_revenue
 FROM marketing_workflows w LEFT JOIN totals t ON t.workflow_id=w.id WHERE w.store_id=$1 ORDER BY attributed_revenue DESC,w.id`,[a.storeId,range.from,range.until])).rows.map(row=>({...row,discount_amount:money(row.discount_amount),attributed_revenue:money(row.attributed_revenue),redemption_rate:row.issued_count?money(new Decimal(row.used_count).div(row.issued_count).mul(100)):0,roi:row.discount_amount?money(new Decimal(row.attributed_revenue).minus(row.discount_amount).div(row.discount_amount)):null}));
 const issued=campaigns.reduce((n,r)=>n+r.issued_count,0),used=campaigns.reduce((n,r)=>n+r.used_count,0),discount=money(sum(campaigns.map(r=>r.discount_amount))),revenue=money(sum(campaigns.map(r=>r.attributed_revenue)));
 return {...rangeMetadata(range),accounting_basis:'campaign_creation_cohort',roi_basis:'coupon_discount_only',waitlist,campaigns,marketing:{triggered_count:campaigns.reduce((n,r)=>n+r.triggered_count,0),issued_count:issued,used_count:used,discount_amount:discount,attributed_revenue:revenue,redemption_rate:issued?money(new Decimal(used).div(issued).mul(100)):0,roi:discount?money(new Decimal(revenue).minus(discount).div(discount)):null}};
}));
reportsRouter.get('/reports/executive-brief',merchantRoute(read,async(req,a)=>{
 const range=dateRange({date:req.query.date}),ledger=await ledgerTotals(a.storeId!,range);
 const states=(await tenantQuery(`SELECT (SELECT count(*) FROM rooms WHERE store_id=$1 AND active=1 AND status='occupied') AS occupied_rooms,
 (SELECT count(*) FROM rooms WHERE store_id=$1 AND active=1 AND status='idle') AS idle_rooms,
 (SELECT count(*) FROM technicians WHERE store_id=$1 AND active=1 AND status='on') AS idle_technicians,
 (SELECT count(*) FROM items WHERE store_id=$1 AND type='product' AND active=1 AND stock>=0 AND stock<=low_stock_threshold) AS low_stock,
 (SELECT count(*) FROM approval_requests WHERE store_id=$1 AND status='pending') AS pending_approvals,
 (SELECT count(*) FROM booking_waitlist WHERE store_id=$1 AND status='waiting') AS waiting_customers,
 (SELECT coalesce(sum(people),0) FROM queue WHERE store_id=$1 AND status='waiting' AND business_date=(now() AT TIME ZONE 'Asia/Shanghai')::date) AS queue_people,
 (SELECT count(*) FROM members m JOIN merchants t ON t.id=m.merchant_id WHERE (m.store_id=$1 OR t.member_mode='merchant') AND m.status!='archived' AND m.created_at<now()-interval '30 days'
 AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.merchant_id=m.merchant_id AND o.member_id=m.id AND o.store_id=$1 AND o.status='closed' AND o.closed_at >= now()-interval '30 days')) AS dormant_members`,[a.storeId])).rows[0];
 const revenue=money(new Decimal(ledger.total_sales).minus(ledger.total_discount)),tasks=[];
 if(states.pending_approvals)tasks.push({code:'approvals',severity:'high',title:`${states.pending_approvals} 项操作待审批`,action:'在审批中心核对并处理'});
 if(states.low_stock)tasks.push({code:'stock',severity:'warning',title:`${states.low_stock} 项商品或耗材达到预警线`,action:'在库存管理核对并安排补货'});
 if(states.waiting_customers)tasks.push({code:'waitlist',severity:'warning',title:`${states.waiting_customers} 组预约候补待安排`,action:'结合房间与技师排班安排预约'});
 if(states.queue_people)tasks.push({code:'queue',severity:'warning',title:`${states.queue_people} 人正在排队`,action:'在排队叫号中安排接待'});
 if(states.dormant_members)tasks.push({code:'members',severity:'info',title:`${states.dormant_members} 位会员超过 30 天未在本店消费`,action:'在会员报表中查看并制定回访计划'});
 return {date:range.start,generated_at:new Date().toISOString(),operational_state:'current',kpis:{...states,revenue,orders:ledger.order_count,reversals:ledger.reversal_count,avg_ticket:ledger.order_count?money(new Decimal(revenue).div(ledger.order_count)):0,discounts:ledger.total_discount},tasks};
}));
