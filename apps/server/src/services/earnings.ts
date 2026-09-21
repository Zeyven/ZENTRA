import {Decimal} from 'decimal.js';
import {tenantQuery} from '../db/pools.js';
import {calculateCommission} from './commission-engine.js';
import {money,sum} from '../business.js';
import type {dateRange} from './dates.js';
export async function technicianEarnings(storeId:number,range:ReturnType<typeof dateRange>,ownId?:number){
 // One PostgreSQL statement captures configuration and service rows at the same point in time, including for payroll locking.
 const source=(await tenantQuery(`SELECT jsonb_build_object(
 'technicians',coalesce((SELECT jsonb_agg(t ORDER BY t.id) FROM (SELECT id,name,code,level,active,base_salary,commission_rate,wheel_rate,dianzhong_rate,half_rate,dianzhong_bonus,add_time_rate FROM technicians WHERE store_id=$1 AND ($4::bigint IS NULL OR id=$4)) t),'[]'),
 'rules',coalesce((SELECT jsonb_agg(r ORDER BY priority,id) FROM commission_rules r WHERE store_id=$1 AND active=1),'[]'),
 'tiers',coalesce((SELECT value::jsonb FROM settings WHERE store_id=$1 AND key='commission_tiers'),'[]'),
 'lines',coalesce((SELECT jsonb_agg(s ORDER BY id) FROM (SELECT oi.id,oi.order_id,oi.item_id,oi.quantity,oi.amount,oi.service_type,oi.add_time_amount,oi.add_time_count,oi.technician_id,
 to_char(oi.clock_out_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS clock_out_at
 FROM order_items oi JOIN orders o ON o.merchant_id=oi.merchant_id AND o.id=oi.order_id
 WHERE oi.store_id=$1 AND oi.item_type='service' AND oi.is_refund=0 AND oi.is_gift=0 AND o.status!='cancelled'
 AND oi.clock_out_at >= $2::timestamptz AND oi.clock_out_at < $3::timestamptz AND ($4::bigint IS NULL OR oi.technician_id=$4)) s),'[]')) AS data`,[storeId,range.from,range.until,ownId??null])).rows[0].data;
 const grouped=new Map<number,any[]>();for(const line of source.lines){const list=grouped.get(line.technician_id)??[];list.push(line);grouped.set(line.technician_id,list)}
 const tiers=[...source.tiers].sort((a,b)=>b.min-a.min);
 return source.technicians.filter((tech:any)=>tech.active===1||grouped.has(tech.id)).map((tech:any)=>{
  const services=grouped.get(tech.id)??[],amount=money(sum(services.map(s=>s.amount))),orders=new Map<number,number>();
  for(const line of services)orders.set(line.order_id,(orders.get(line.order_id)??0)+line.quantity);
  const baseRate=tiers.find(t=>amount>=t.min&&(t.max===undefined||amount<=t.max))?.rate??tech.commission_rate,addRate=tech.add_time_rate>0?tech.add_time_rate:baseRate;
  const lines:any[]=[];for(const service of services){
   const base=money(new Decimal(service.amount).minus(service.add_time_amount));
   lines.push({...service,technician_level:tech.level,amount:Math.max(0,base),is_add_time:false});
   if(service.add_time_amount>0)lines.push({...service,id:service.id+':add',technician_level:tech.level,amount:service.add_time_amount,quantity:service.add_time_count||1,service_type:'加钟',is_add_time:true});
  }
  const fallback={baseRate,wheelRate:tech.wheel_rate,dianzhongRate:tech.dianzhong_rate,halfRate:tech.half_rate,addTimeRate:addRate,dianzhongBonus:tech.dianzhong_bonus};
  const calculation=calculateCommission({rules:source.rules,lines,fallback});const byId=new Map(lines.map(l=>[l.id,l]));
  const bonus=money(sum(calculation.details.filter(d=>d.fallback&&byId.get(d.line_id)?.service_type==='点钟').map(()=>tech.dianzhong_bonus)));
  return {...tech,commission_rate:baseRate,add_time_rate:addRate,served_orders:orders.size,served_count:services.reduce((n,l)=>n+l.quantity,0),served_cnt:services.reduce((n,l)=>n+l.quantity,0),
   dianzhong_count:services.filter(l=>l.service_type==='点钟').reduce((n,l)=>n+l.quantity,0),add_time_count:services.reduce((n,l)=>n+l.add_time_count,0),add_time_amount:money(sum(services.map(l=>l.add_time_amount))),service_amount:amount,
   avg_price:orders.size?money(new Decimal(amount).div(orders.size)):0,add_item_rate:orders.size?money(new Decimal([...orders.values()].filter(n=>n>=2).length).div(orders.size).mul(100)):0,
   commission:calculation.total,commission_detail:calculation.details,dianzhong_bonus_total:bonus,add_time_commission:money(sum(calculation.details.filter(d=>String(d.line_id).endsWith(':add')).map(d=>d.commission))),salary:money(new Decimal(tech.base_salary).plus(calculation.total)),
   calculation_snapshot:{rules:source.rules,tiers:source.tiers,fallback,lines}};
 }).sort((a:any,b:any)=>b.salary-a.salary||a.id-b.id);
}
