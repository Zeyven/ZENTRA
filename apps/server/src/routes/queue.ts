import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,input,idempotent,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {QueueInput,queueTake,queueSummary} from '../services/queue.js';
export const queueRouter=Router();
const access={store:true,roles:['manager','floor']};
queueRouter.get('/queue/summary',merchantRoute({...access,support:'read'},queueSummary));
queueRouter.get('/queue',merchantRoute({...access,support:'read'},async(req,actor)=>{
 const q=z.object({status:z.enum(['','all','waiting','called','done','cancelled']).default('all'),date:z.iso.date().optional(),limit:z.coerce.number().int().min(1).max(500).default(200)}).parse(req.query);
 return (await tenantQuery(`SELECT id,queue_no,customer_name,people,phone,status,created_at,called_at,business_date,version FROM queue WHERE store_id=$1 AND business_date=coalesce($2::date,(now() AT TIME ZONE 'Asia/Shanghai')::date) AND ($3::text IS NULL OR status=$3) ORDER BY id LIMIT $4`,[actor.storeId,q.date??null,['','all'].includes(q.status)?null:q.status,q.limit])).rows;
}));
queueRouter.post('/queue/take',merchantRoute({...access,write:true},async req=>idempotent(req,'queue.take',()=>queueTake(QueueInput.parse(input(req))))));
for(const [action,status] of [['call','called'],['done','done'],['cancel','cancelled']] as const)queueRouter.post('/queue/:id/'+action,merchantRoute({...access,write:true},async(req,actor)=>idempotent(req,'queue.'+action+':'+req.params.id,async()=>{
 const b=z.object({version:Id}).strict().parse(input(req));const row=await storeObject('queue',Id.parse(req.params.id),actor.storeId!,true);
 ensure(row.version===b.version,409,'STALE_QUEUE','排号已被其他终端修改，请刷新后操作');ensure(['waiting','called'].includes(row.status),409,'QUEUE_FINISHED','排号已结束，不能再次操作');
 const next=(await tenantQuery(`UPDATE queue SET status=$1,called_at=CASE WHEN $1='called' THEN now() ELSE called_at END,version=version+1 WHERE id=$2 RETURNING id,queue_no,customer_name,people,phone,status,created_at,called_at,business_date,version`,[status,row.id])).rows[0];
 await audit('queue.'+action,{},'queue',row.id);await event('queue.changed',row.id);return next;
})));
