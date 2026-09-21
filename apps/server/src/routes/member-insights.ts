import {Router} from 'express';
import {merchantRoute} from '../access.js';
import {tenantQuery} from '../db/pools.js';
export const memberInsightsRouter=Router();
const access={store:true,roles:['manager'],support:'read' as const};
async function profiles(storeId:number){return (await tenantQuery(`SELECT m.id,m.name,m.phone,m.balance,m.bonus_balance,m.times_balance,m.points,m.level,m.created_at,
 coalesce(sum(o.payable),0) AS total_consume,count(o.id) AS consume_cnt,coalesce(max(o.closed_at),m.created_at) AS last_active
 FROM members m JOIN merchants t ON t.id=m.merchant_id LEFT JOIN orders o ON o.merchant_id=m.merchant_id AND o.member_id=m.id AND o.store_id=$1 AND o.status='closed'
 WHERE (m.store_id=$1 OR t.member_mode='merchant') AND m.status!='archived' GROUP BY m.id ORDER BY total_consume DESC,m.id LIMIT 5000`,[storeId])).rows}
memberInsightsRouter.get('/members/analysis',merchantRoute(access,async(_req,actor)=>{
 const base=await profiles(actor.storeId!),cutoff=Date.now()-90*86400000;
 const high_refund=(await tenantQuery(`SELECT m.id,m.name,count(oi.id) AS refund_cnt FROM members m JOIN orders o ON o.merchant_id=m.merchant_id AND o.member_id=m.id JOIN order_items oi ON oi.merchant_id=o.merchant_id AND oi.order_id=o.id WHERE o.store_id=$1 AND oi.is_refund=1 AND oi.clock_out_at>=now()-interval '30 days' GROUP BY m.id HAVING count(oi.id)>=3 ORDER BY refund_cnt DESC LIMIT 20`,[actor.storeId])).rows;
 const long_idle=base.filter(m=>(m.balance+m.bonus_balance>0||m.times_balance>0)&&new Date(m.last_active).getTime()<cutoff).slice(0,20);
 const abnormal_hours=(await tenantQuery(`SELECT m.id,m.name,count(*) AS cnt FROM members m JOIN orders o ON o.merchant_id=m.merchant_id AND o.member_id=m.id WHERE o.store_id=$1 AND o.status='closed' AND extract(hour FROM o.closed_at AT TIME ZONE 'Asia/Shanghai') BETWEEN 1 AND 5 GROUP BY m.id HAVING count(*)>=3 ORDER BY cnt DESC LIMIT 20`,[actor.storeId])).rows;
 return {high_refund,long_idle,high_balance_idle:long_idle.filter(m=>m.balance>=500),abnormal_hours};
}));
memberInsightsRouter.get('/members/segments',merchantRoute(access,async(_req,actor)=>{
 const result:Record<string,any[]>={high_value:[],active:[],sleeping:[],new_customer:[]};
 for(const member of await profiles(actor.storeId!)){const days=Math.floor((Date.now()-new Date(member.last_active).getTime())/86400000);
  if(member.total_consume>=1000||member.balance>=1000)result.high_value.push(member);
  else if(days>90)result.sleeping.push(member);else if(member.consume_cnt===0)result.new_customer.push(member);else if(days<=30)result.active.push(member);
 }
 return result;
}));
