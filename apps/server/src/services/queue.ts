import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {context,tenantQuery} from '../db/pools.js';
import {audit,event} from '../access.js';
import {digest} from '../security.js';
export const QueueInput=z.object({customer_name:z.string().trim().min(1).max(100),people:z.number().int().min(1).max(1000).default(1),phone:z.string().trim().max(40).default('')}).strict();
export async function queueTake(b:z.infer<typeof QueueInput>,publicEntry=false){
 const c=context();await tenantQuery('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${c.merchantId}:${c.storeId}:queue`]);
 const day=(await tenantQuery("SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date::text AS value")).rows[0].value;
 const next=(await tenantQuery('SELECT count(*)+1 AS value FROM queue WHERE store_id=$1 AND business_date=$2',[c.storeId,day])).rows[0].value;
 const token=publicEntry?randomBytes(32).toString('base64url'):null;
 const row=(await tenantQuery('INSERT INTO queue(store_id,queue_no,customer_name,people,phone,business_date,access_token_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,queue_no,customer_name,people,phone,business_date,status,created_at,called_at,version',[c.storeId,'A'+String(next).padStart(3,'0'),b.customer_name,b.people,b.phone,day,token?digest(token):null])).rows[0];
 await audit(publicEntry?'queue.public_taken':'queue.taken',{queue_no:row.queue_no},'queue',row.id);await event('queue.changed',row.id);return {...row,...(token?{access_token:token}:{})};
}
export async function queueSummary(){return (await tenantQuery(`SELECT count(*) FILTER(WHERE status='waiting') AS waiting_count,coalesce(sum(people) FILTER(WHERE status='waiting'),0) AS waiting_people,
 (SELECT queue_no FROM queue WHERE store_id=$1 AND business_date=(now() AT TIME ZONE 'Asia/Shanghai')::date AND status='called' ORDER BY called_at DESC,id DESC LIMIT 1) AS called_no
 FROM queue WHERE store_id=$1 AND business_date=(now() AT TIME ZONE 'Asia/Shanghai')::date`,[context().storeId])).rows[0]}
