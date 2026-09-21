import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,PositiveMoney,idempotent,input,canonical,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {digest} from '../security.js';
import {clockSelect,clockView} from '../services/clocks.js';
import {lockOrder,recalculate} from '../services/orders.js';
export const clocksRouter=Router();
const access={store:true,roles:['manager','floor','technician']};
clocksRouter.get('/clocks',merchantRoute({...access,support:'read'},async(_req,actor)=>{
 const rows=(await tenantQuery(`${clockSelect} WHERE oi.store_id=$1 AND o.status='open' AND oi.item_type='service' AND oi.is_refund=0 AND ($2::bigint IS NULL OR oi.technician_id=$2) ORDER BY oi.id`,[actor.storeId,actor.role==='technician'?actor.technicianId:null])).rows;
 const ids=rows.map(row=>row.id),requests=(await tenantQuery("SELECT * FROM clock_events WHERE order_item_id=ANY($1::bigint[]) AND action='request-add-time' AND resolved_at IS NULL",[ids])).rows;
 const reminders=(await tenantQuery('SELECT * FROM clock_reminders WHERE order_item_id=ANY($1::bigint[]) ORDER BY id DESC',[ids])).rows;
 return {server_now:Date.now(),clocks:rows.map(row=>{const view=clockView(row);return {...view,reminders:view.state==='PAUSED'?[]:reminders.filter(r=>r.order_item_id===row.id&&new Date(r.expected_end_at).toISOString()===view.expected_end_at).slice(0,1),requests:requests.filter(r=>r.order_item_id===row.id).map(r=>({id:r.id,reason:r.reason,created_at:r.created_at,minutes:JSON.parse(r.after_snapshot).requested_minutes}))}}),
 rooms:actor.role==='technician'?[...new Map(rows.filter(r=>r.room_id).map(r=>[r.room_id,{id:r.room_id,room_no:r.room_no}])).values()]:(await tenantQuery('SELECT id,room_no FROM rooms WHERE store_id=$1 AND active=1 ORDER BY room_no',[actor.storeId])).rows,
 can_manage:['owner','manager'].includes(actor.role),confirmation_mode:(await tenantQuery("SELECT value FROM settings WHERE store_id=$1 AND key='clock_confirmation_mode'",[actor.storeId])).rows[0]?.value==='1'};
}));
clocksRouter.post('/clocks/settings',merchantRoute({write:true,store:true,roles:['manager'],support:'configuration'},async(req,actor)=>{
 const body=z.object({confirmation_mode:z.boolean()}).strict().parse(input(req));await tenantQuery("INSERT INTO settings(store_id,key,value) VALUES($1,'clock_confirmation_mode',$2) ON CONFLICT(merchant_id,store_id,key) DO UPDATE SET value=excluded.value",[actor.storeId,body.confirmation_mode?'1':'0']);await audit('clock.mode',body);await event('clock-mode');return body;
}));
clocksRouter.get('/clocks/:id/events',merchantRoute({...access,support:'read'},async(req,actor)=>{
 const id=Id.parse(req.params.id),item=await storeObject('order_items',id,actor.storeId!);ensure(actor.role!=='technician'||item.technician_id===actor.technicianId,404,'NOT_FOUND','钟单不存在或无权查看');
 return (await tenantQuery('SELECT id,action,reason,created_at,resolved_at FROM clock_events WHERE order_item_id=$1 ORDER BY id DESC LIMIT 100',[id])).rows;
}));
clocksRouter.post('/clocks/:id/:action',merchantRoute({...access,write:true},async(req,actor)=>idempotent(req,'clocks.'+req.params.action+':'+req.params.id,async()=>{
 const action=z.enum(['ready','start','pause','resume','finish','request-add-time','add-time']).parse(req.params.action),id=Id.parse(req.params.id);
 const body=z.object({expected_version:Id,reason:z.string().trim().max(500).default(''),minutes:z.number().int().min(1).max(240).optional(),amount:PositiveMoney.optional(),request_event_id:Id.optional()}).strict().parse(input(req));
 const peek=await storeObject('order_items',id,actor.storeId!);await lockOrder(peek.order_id,body.expected_version);
 const row=(await tenantQuery(`${clockSelect} WHERE oi.id=$1 AND oi.store_id=$2 FOR UPDATE OF oi`,[id,actor.storeId])).rows[0];
 ensure(row.item_type==='service'&&(actor.role!=='technician'||row.technician_id===actor.technicianId),404,'NOT_FOUND','钟单不存在或无权操作');
 const before=clockView(row);ensure(!['COMPLETED','CANCELLED','WAITING'].includes(before.state),409,'CLOCK_STATE','当前钟单状态不能执行此操作');
 if(action==='add-time')ensure(['owner','manager'].includes(actor.role)&&body.amount!==undefined&&row.is_gift===0,403,'ADD_TIME_FORBIDDEN','加钟金额需要店长或老板确认，赠送项目不能直接加钟');
 if(['request-add-time','add-time'].includes(action))ensure(body.minutes,400,'MINUTES_REQUIRED','请填写加钟分钟数');
 if(action==='pause'||(action==='finish'&&before.remaining_seconds!>300))ensure(body.reason.length>=2,400,'REASON_REQUIRED','暂停或提前下钟需要填写原因');
 if(['ready','start'].includes(action))ensure(['ASSIGNED','READY'].includes(before.state),409,'CLOCK_STARTED','服务已经起钟');
 if(action==='pause')ensure(['IN_SERVICE','ENDING_SOON','OVERTIME'].includes(before.state),409,'CLOCK_STATE','当前状态不可暂停');
 if(action==='resume')ensure(before.state==='PAUSED',409,'CLOCK_STATE','服务未暂停');
 if(['finish','add-time'].includes(action))ensure(row.clock_in_at,409,'CLOCK_NOT_STARTED','请先确认上钟');
 if(action==='request-add-time')ensure(!(await tenantQuery("SELECT 1 FROM clock_events WHERE order_item_id=$1 AND action='request-add-time' AND resolved_at IS NULL",[id])).rowCount,409,'PENDING_REQUEST','已有待确认的加钟申请');
 let pending:any;
 if(action==='add-time'&&body.request_event_id){pending=(await tenantQuery("SELECT * FROM clock_events WHERE id=$1 AND order_item_id=$2 AND action='request-add-time' AND resolved_at IS NULL FOR UPDATE",[body.request_event_id,id])).rows[0];ensure(pending&&JSON.parse(pending.after_snapshot).requested_minutes===body.minutes,409,'REQUEST_CHANGED','加钟申请已处理或分钟数不符')}
 if(action==='ready')await tenantQuery('UPDATE order_items SET clock_ready_at=now() WHERE id=$1',[id]);
 if(action==='start')await tenantQuery('UPDATE order_items SET clock_in_at=now(),clock_ready_at=coalesce(clock_ready_at,now()) WHERE id=$1',[id]);
 if(action==='pause')await tenantQuery('UPDATE order_items SET clock_paused_at=now() WHERE id=$1',[id]);
 if(action==='resume')await tenantQuery('UPDATE order_items SET clock_paused_seconds=clock_paused_seconds+greatest(0,floor(extract(epoch FROM(now()-clock_paused_at))))::integer,clock_paused_at=NULL WHERE id=$1',[id]);
 if(action==='finish'){
  await tenantQuery("UPDATE order_items SET status='done',clock_out_at=now(),clock_paused_at=NULL WHERE id=$1",[id]);await tenantQuery("UPDATE clock_events SET resolved_at=now() WHERE order_item_id=$1 AND action='request-add-time' AND resolved_at IS NULL",[id]);
  await tenantQuery("UPDATE technicians t SET status='on' WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.technician_id=t.id AND oi.status='active' AND oi.is_refund=0)",[row.technician_id]);
 }
 if(action==='add-time'){await tenantQuery('UPDATE order_items SET duration=duration+$1,amount=amount+$2,add_time_amount=add_time_amount+$2,add_time_count=add_time_count+1 WHERE id=$3',[body.minutes,body.amount,id]);if(pending)await tenantQuery('UPDATE clock_events SET resolved_at=now() WHERE id=$1',[pending.id])}
 await recalculate(row.order_id);const after:any=clockView((await tenantQuery(`${clockSelect} WHERE oi.id=$1`,[id])).rows[0]);
 if(action==='request-add-time')after.requested_minutes=body.minutes;if(action==='add-time')Object.assign(after,{approved_amount:body.amount,added_minutes:body.minutes,request_event_id:pending?.id??null});
 const result={server_now:Date.now(),clock:after};
 await tenantQuery('INSERT INTO clock_events(store_id,order_item_id,user_id,action,reason,request_key,request_hash,before_snapshot,after_snapshot,response_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[actor.storeId,id,actor.user.id,action,body.reason,req.headers['idempotency-key']??req.body.request_key,digest(canonical(body)),JSON.stringify(before),JSON.stringify(after),JSON.stringify(result)]);
 await audit('clock.'+action,{before,after,reason:body.reason},'order_item',id);await event('clock-'+action,id);return result;
})));
clocksRouter.post('/technicians/:id/clock',merchantRoute({...access,write:true},async(req,actor)=>idempotent(req,'technicians.clock:'+req.params.id,async()=>{
 const id=Id.parse(req.params.id);const body=z.object({status:z.enum(['on','off','rest']).optional()}).strict().parse(input(req));ensure(actor.role!=='technician'||id===actor.technicianId,403,'OWN_TECHNICIAN_ONLY','只能操作本人考勤状态');
 const technician=await storeObject('technicians',id,actor.storeId!,true);ensure(technician.active===1,409,'TECHNICIAN_INACTIVE','技师档案已停用');ensure(technician.status!=='serving',409,'TECHNICIAN_BUSY','请先结束当前服务');
 const status=body.status??(technician.status==='off'?'on':'off');
 ensure(!(technician.status==='off'&&status==='rest'),409,'CLOCK_IN_REQUIRED','请先上班打卡，再进入休息状态');
 if(status==='on'&&technician.status==='off')await tenantQuery("INSERT INTO attendance(store_id,technician_id,clock_in_at,date) VALUES($1,$2,now(),to_char(now(),'YYYY-MM-DD'))",[actor.storeId,id]);
 if(status==='off')await tenantQuery('UPDATE attendance SET clock_out_at=now() WHERE technician_id=$1 AND clock_out_at IS NULL',[id]);
 await tenantQuery('UPDATE technicians SET status=$1 WHERE id=$2',[status,id]);await audit('technician.clock',{status},'technician',id);await event('technician',id);return {id,status};
})));
