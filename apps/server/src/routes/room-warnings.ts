import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event,type Actor} from '../access.js';
import {tenantQuery,context} from '../db/pools.js';
import {Id,input,idempotent,storeObject,canonical} from '../business.js';
import {digest} from '../security.js';
import {ensure} from '../errors.js';
export const roomWarningsRouter=Router();
const read={store:true,roles:['manager','floor','technician'],support:'read' as const},send={store:true,write:true,roles:['manager','floor']};
async function rooms(a:Actor){return (await tenantQuery(`SELECT r.id,r.room_no FROM rooms r WHERE r.store_id=$1 AND r.active=1 AND ($2::bigint IS NULL OR EXISTS(
 SELECT 1 FROM orders o JOIN order_items oi ON oi.merchant_id=o.merchant_id AND oi.order_id=o.id WHERE o.room_id=r.id AND o.status='open' AND oi.technician_id=$2 AND oi.is_refund=0 AND oi.status='active')) ORDER BY r.id`,[a.storeId,a.role==='technician'?a.technicianId:null])).rows}
roomWarningsRouter.get('/clocks/warnings',merchantRoute(read,async(_req,a)=>{
 const allowed=await rooms(a),now=Date.now();const warnings=(await tenantQuery(`SELECT id,room_id,message,created_at,expires_at,acknowledged_at,acknowledged_by,cancelled_at FROM room_warnings WHERE store_id=$1 AND room_id=ANY($2::bigint[])
 ORDER BY CASE WHEN acknowledged_at IS NULL AND cancelled_at IS NULL AND expires_at>$3 THEN 0 ELSE 1 END,id DESC LIMIT 200`,[a.storeId,allowed.map(r=>r.id),now])).rows;
 return {server_now:now,can_send:['owner','manager','floor'].includes(a.role),rooms:allowed,warnings};
}));
async function capacity(storeId:number,count:number){
 await tenantQuery('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[context().merchantId+':room-warning:'+storeId]);
 const pending=(await tenantQuery('SELECT count(*)::int AS count FROM room_warnings WHERE store_id=$1 AND acknowledged_at IS NULL AND cancelled_at IS NULL AND expires_at>$2',[storeId,Date.now()])).rows[0].count;
 ensure(pending+count<=100,409,'TOO_MANY_WARNINGS','未结束警告过多，请先处理旧警告；本次未发送');
}
async function insert(a:Actor,roomId:number,message:string,key:string){
 const now=Date.now(),row=(await tenantQuery('INSERT INTO room_warnings(store_id,room_id,message,sent_by,request_key,request_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[a.storeId,roomId,message,a.user.id,key,digest(canonical({roomId,message,user:a.user.id})),now,now+30*60000])).rows[0];
 await audit('room_warning.sent',{room_id:roomId,message},'room_warning',row.id);return row;
}
roomWarningsRouter.post('/clocks/warnings',merchantRoute(send,async(req,a)=>idempotent(req,'room-warning.send',async()=>{
 const b=z.object({room_id:Id,message:z.string().trim().min(1).max(200)}).strict().parse(input(req)),room=await storeObject('rooms',b.room_id,a.storeId!);ensure(room.active===1,409,'ROOM_INACTIVE','房间已停用');await capacity(a.storeId!,1);
 const row=await insert(a,b.room_id,b.message,String(req.headers['idempotency-key']??req.body.request_key));await event('room-warning',row.id);return row;
})));
roomWarningsRouter.post('/clocks/warnings/broadcast',merchantRoute(send,async(req,a)=>idempotent(req,'room-warning.broadcast',async()=>{
 z.object({}).strict().parse(input(req));const allowed=await rooms(a);ensure(allowed.length,409,'NO_ROOMS','当前门店没有启用房间');await capacity(a.storeId!,allowed.length);const ids=[];
 for(const room of allowed){const row=await insert(a,room.id,'请注意，前台发出全店预警，请立即联系前台。',String(req.headers['idempotency-key']??req.body.request_key)+':'+room.id);ids.push(row.id)}
 await event('room-warning');return {room_count:ids.length,warning_ids:ids};
})));
roomWarningsRouter.post('/clocks/warnings/:id/:action',merchantRoute({store:true,write:true,roles:['manager','floor','technician']},async(req,a)=>idempotent(req,'room-warning.'+req.params.action+':'+req.params.id,async()=>{
 const action=z.enum(['acknowledge','cancel']).parse(req.params.action);z.object({}).strict().parse(input(req));ensure(action!=='cancel'||a.role!=='technician',403,'CANCEL_FORBIDDEN','技师不能撤销前台警告');
 const row=await storeObject('room_warnings',Id.parse(req.params.id),a.storeId!,true);ensure((await rooms(a)).some(r=>r.id===row.room_id),404,'WARNING_FORBIDDEN','警告不属于授权房间');
 if(action==='acknowledge'&&row.acknowledged_by===a.user.id||action==='cancel'&&row.cancelled_at)return row;
 ensure(row.expires_at>Date.now()&&!row.acknowledged_at&&!row.cancelled_at,409,'WARNING_FINISHED','警告已结束，请刷新');
 const result=action==='acknowledge'?(await tenantQuery('UPDATE room_warnings SET acknowledged_at=$1,acknowledged_by=$2 WHERE id=$3 RETURNING *',[Date.now(),a.user.id,row.id])).rows[0]:(await tenantQuery('UPDATE room_warnings SET cancelled_at=$1 WHERE id=$2 RETURNING *',[Date.now(),row.id])).rows[0];
 await audit('room_warning.'+action,{room_id:row.room_id},'room_warning',row.id);await event('room-warning',row.id);return result;
})));
