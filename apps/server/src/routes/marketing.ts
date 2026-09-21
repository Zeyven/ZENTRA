import {Router} from 'express';
import {z} from 'zod';
import {MarketingTrigger,MarketingWorkflow,marketingDefaults} from '@za-spa/contracts';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {idempotent,Id,input,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {runStoreMarketing} from '../services/marketing.js';
export const marketingRouter=Router();
const read={store:true,roles:['manager'],support:'read' as const},write={store:true,roles:['manager'],write:true,action:'discount'};
marketingRouter.get('/marketing/workflows',merchantRoute(read,async(_req,actor)=>{
 const rows=(await tenantQuery('SELECT * FROM marketing_workflows WHERE store_id=$1',[actor.storeId])).rows;
 return marketingDefaults.map(draft=>rows.find(row=>row.trigger_type===draft.trigger_type)??draft);
}));
marketingRouter.put('/marketing/workflows/:trigger',merchantRoute(write,async(req,actor)=>idempotent(req,'marketing.workflow:'+req.params.trigger,async()=>{
 const trigger=MarketingTrigger.parse(req.params.trigger),body=MarketingWorkflow.parse(input(req));ensure(!body.enabled||body.channel==='in_app',409,'CHANNEL_NOT_CONNECTED','短信或微信营销接口尚未接入，请使用系统券包');
 await tenantQuery("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[actor.merchant.id+':marketing-config:'+actor.storeId+':'+trigger]);
 const old=(await tenantQuery('SELECT * FROM marketing_workflows WHERE store_id=$1 AND trigger_type=$2 FOR UPDATE',[actor.storeId,trigger])).rows[0];ensure((old?.version??0)===body.version,409,'VERSION_CONFLICT','工作流已被其他终端修改，请刷新核对');
 const values=[body.name,Number(body.enabled),body.delay_days,body.dormant_days,body.coupon_name,body.coupon_value,body.coupon_min_amount,body.coupon_expire_days,body.channel];
 const row=old?(await tenantQuery('UPDATE marketing_workflows SET name=$1,enabled=$2,delay_days=$3,dormant_days=$4,coupon_name=$5,coupon_value=$6,coupon_min_amount=$7,coupon_expire_days=$8,channel=$9,version=version+1,updated_at=now() WHERE id=$10 RETURNING *',[...values,old.id])).rows[0]:(await tenantQuery('INSERT INTO marketing_workflows(name,enabled,delay_days,dormant_days,coupon_name,coupon_value,coupon_min_amount,coupon_expire_days,channel,store_id,trigger_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[...values,actor.storeId,trigger])).rows[0];
 await audit('marketing.workflow.saved',{before:old,after:row},'marketing_workflow',row.id);await event('marketing.changed',row.id);return row;
})));
marketingRouter.post('/marketing/run',merchantRoute(write,async(req,actor)=>idempotent(req,'marketing.run',()=>runStoreMarketing(actor.storeId!))));
marketingRouter.get('/marketing/outbox',merchantRoute(read,async(req,actor)=>{
 const before=req.query.before?Id.parse(req.query.before):null;
 return (await tenantQuery('SELECT o.*,w.name AS workflow_name,m.name AS member_name FROM marketing_outbox o JOIN marketing_workflows w ON w.merchant_id=o.merchant_id AND w.id=o.workflow_id LEFT JOIN members m ON m.merchant_id=o.merchant_id AND m.id=o.member_id WHERE o.store_id=$1 AND ($2::bigint IS NULL OR o.id<$2) ORDER BY o.id DESC LIMIT 100',[actor.storeId,before])).rows;
}));
marketingRouter.post('/marketing/outbox/:id/retry',merchantRoute(write,async(req,actor)=>idempotent(req,'marketing.retry:'+req.params.id,async()=>{
 const body=z.object({reason:z.string().trim().min(1).max(500)}).strict().parse(input(req)),row=await storeObject('marketing_outbox',Id.parse(req.params.id),actor.storeId!,true);
 ensure(row.status==='failed'&&!row.coupon_id,409,'TASK_NOT_RETRYABLE','仅失败且尚未发券的任务可重新排队');ensure(row.channel==='in_app',409,'CHANNEL_NOT_CONNECTED','外部营销渠道尚未接入');
 await tenantQuery("UPDATE marketing_outbox SET status='pending',attempts=0,next_retry_at=NULL WHERE id=$1",[row.id]);await audit('marketing.requeued',{reason:body.reason,last_error_code:row.last_error_code},'marketing_outbox',row.id);await event('marketing.changed',row.id);return {queued:true};
})));
