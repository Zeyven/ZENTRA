import {context,inTenant,tenantQuery} from '../db/pools.js';
import {audit,event} from '../access.js';
import {MarketingWorkflow} from '@za-spa/contracts';

// A trigger key describes the business episode, not the date of each scan.
// Idle/new members therefore do not receive the same promotion every day.
async function schedule(storeId:number,w:any){
 const base="m.store_id=$1 AND m.status='active'";
 const queries:Record<string,string>={
  new_member_no_visit:`SELECT m.id,m.phone,'new:'||m.id AS key FROM members m WHERE ${base} AND m.created_at<=now()-make_interval(days=>$2) AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.member_id=m.id AND o.status='closed')`,
  birthday:`SELECT m.id,m.phone,'birthday:'||m.id||':'||to_char(now(),'YYYY') AS key FROM members m WHERE ${base} AND right(m.birthday,5)=to_char(now(),'MM-DD')`,
  member_expiry:`SELECT m.id,m.phone,'expiry:'||m.id||':'||m.expiry AS key FROM members m WHERE ${base} AND m.expiry>=to_char(now(),'YYYY-MM-DD') AND m.expiry<=to_char(now()+interval '7 days','YYYY-MM-DD')`,
  dormant:`SELECT m.id,m.phone,'dormant:'||m.id||':'||coalesce((SELECT max(o.closed_at)::text FROM orders o WHERE o.member_id=m.id AND o.status='closed'),m.created_at::text) AS key FROM members m WHERE ${base} AND m.created_at<=now()-make_interval(days=>$3) AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.member_id=m.id AND o.status='closed' AND o.closed_at>now()-make_interval(days=>$3))`,
  after_visit:`SELECT m.id,m.phone,'visit:'||o.id AS key FROM orders o JOIN members m ON m.merchant_id=o.merchant_id AND m.id=o.member_id WHERE o.store_id=$1 AND m.status='active' AND o.status='closed' AND o.closed_at>=$4 AND o.closed_at<=now()-make_interval(days=>$2)`,
  booking_cancel:`SELECT m.id,m.phone,'cancel:'||r.id||':'||m.id AS key FROM reservations r JOIN members m ON m.merchant_id=r.merchant_id AND m.phone=r.customer_phone WHERE ${base} AND r.store_id=$1 AND r.status IN('cancelled','deleted') AND r.cancelled_at>=$4 AND r.cancelled_at<=now()-make_interval(days=>$2)`
 };
 // All four parameters are explicitly typed, including those not used by a trigger.
 const query=queries[w.trigger_type];if(!query)throw Error('Unknown marketing trigger');
 const result=await tenantQuery(`WITH parameters AS(SELECT $1::bigint,$2::int,$3::int,$4::timestamptz),candidates AS(${query})
 INSERT INTO marketing_outbox(store_id,workflow_id,member_id,customer_phone,trigger_key,scheduled_at,channel,detail)
 SELECT $1,$5,c.id,c.phone,c.key,now()+make_interval(days=>CASE WHEN $8::text IN('birthday','member_expiry','dormant') THEN $2 ELSE 0 END),$6,$7 FROM candidates c WHERE NOT EXISTS(SELECT 1 FROM marketing_outbox old WHERE old.workflow_id=$5 AND old.trigger_key=c.key) ORDER BY c.id,c.key LIMIT 200 ON CONFLICT(merchant_id,workflow_id,trigger_key) DO NOTHING RETURNING id`,[storeId,w.delay_days,w.dormant_days,w.created_at,w.id,w.channel,JSON.stringify({workflow:{...w,enabled:Boolean(w.enabled)},trigger:w.trigger_type}),w.trigger_type]);
 return result.rowCount??0;
}
export async function runStoreMarketing(storeId:number){
 context().storeId=storeId;
 const active=(await tenantQuery("SELECT 1 FROM stores s JOIN merchants m ON m.id=s.merchant_id WHERE s.id=$1 AND s.status=1 AND m.status='active'",[storeId])).rowCount;if(!active)return {scheduled:0,issued:0,failed:0};
 const locked=(await tenantQuery("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) acquired",[context().merchantId+':marketing:'+storeId])).rows[0].acquired;if(!locked)return {scheduled:0,issued:0,failed:0};
 let scheduled=0,issued=0,failed=0;
 const workflows=(await tenantQuery('SELECT * FROM marketing_workflows WHERE store_id=$1 AND enabled=1 ORDER BY id',[storeId])).rows;
 for(const workflow of workflows)scheduled+=await schedule(storeId,workflow);
 const rows=(await tenantQuery("SELECT * FROM marketing_outbox WHERE store_id=$1 AND status='pending' AND scheduled_at<=now() AND (next_retry_at IS NULL OR next_retry_at<=now()) ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",[storeId])).rows;
 for(const row of rows){
  await tenantQuery('SAVEPOINT dispatch_marketing');
  try{
   const workflow=(await tenantQuery('SELECT enabled FROM marketing_workflows WHERE id=$1 FOR SHARE',[row.workflow_id])).rows[0],member=(await tenantQuery('SELECT status FROM members WHERE id=$1 FOR SHARE',[row.member_id])).rows[0];
   if(!workflow?.enabled||member?.status!=='active'){await tenantQuery("UPDATE marketing_outbox SET status='skipped',processed_at=now(),last_error_code='WORKFLOW_OR_MEMBER_INACTIVE' WHERE id=$1",[row.id]);continue}
   if(row.channel!=='in_app'){await tenantQuery("UPDATE marketing_outbox SET status='failed',attempts=attempts+1,last_error_code='CHANNEL_NOT_CONNECTED',processed_at=now() WHERE id=$1",[row.id]);failed++;continue}
   const saved=JSON.parse(row.detail).workflow;
   const config=MarketingWorkflow.parse(Object.fromEntries(Object.keys(MarketingWorkflow.shape).map(key=>[key,saved[key]])));
   const coupon=(await tenantQuery("INSERT INTO coupons(store_id,member_id,name,type,value,min_amount,expire_at,remark) VALUES($1,$2,$3,'cash',$4,$5,now()+make_interval(days=>$6),$7) RETURNING id",[storeId,row.member_id,config.coupon_name,config.coupon_value,config.coupon_min_amount,config.coupon_expire_days,'自动营销 #'+row.id])).rows[0];
   await tenantQuery("UPDATE marketing_outbox SET status='issued',coupon_id=$1,attempts=attempts+1,processed_at=now(),next_retry_at=NULL,last_error_code=NULL WHERE id=$2",[coupon.id,row.id]);issued++;
  }catch(error){
   await tenantQuery('ROLLBACK TO SAVEPOINT dispatch_marketing');const attempts=row.attempts+1,code=typeof (error as any)?.code==='string'&&/^[A-Z0-9_]{1,40}$/.test((error as any).code)?(error as any).code:'DISPATCH_ERROR';
   await tenantQuery("UPDATE marketing_outbox SET status=$1,attempts=$2,next_retry_at=CASE WHEN $2<3 THEN now()+make_interval(secs=>CASE WHEN $2=1 THEN 60 ELSE 300 END) ELSE NULL END,last_error_code=$3,processed_at=now() WHERE id=$4",[attempts>=3?'failed':'pending',attempts,code,row.id]);failed++;
  }finally{await tenantQuery('RELEASE SAVEPOINT dispatch_marketing')}
 }
 if(scheduled||rows.length){await audit('marketing.processed',{scheduled,issued,failed});await event('marketing.changed');if(issued)await event('coupon.changed')}
 return {scheduled,issued,failed};
}
export async function scanMerchantMarketing(merchantId:string){
 return inTenant(merchantId,async()=>{
  const stores=(await tenantQuery("SELECT s.id FROM stores s JOIN merchants m ON m.id=s.merchant_id WHERE s.status=1 AND m.status='active' AND EXISTS(SELECT 1 FROM marketing_workflows w WHERE w.store_id=s.id AND w.enabled=1) ORDER BY s.id")).rows;
  for(const store of stores)await runStoreMarketing(store.id);
 },{role:'system'});
}
