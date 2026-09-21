import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,input,idempotent} from '../business.js';
import {ensure} from '../errors.js';
import {openReservation,reservationDetail,reservationLock,schedulingLock,syncReservationRoom,validateReservationResources,validateStaff} from '../services/reservations.js';
import {offerWaitlist} from '../services/public-booking.js';
export const reservationsRouter=Router();
const access={store:true,roles:['manager','floor']};
// Wall times submitted by a China store have an explicit zone; ISO values keep theirs.
export const ReservationTime=z.string().transform(value=>{const s=value.replace(' ','T');return /(?:Z|[+-]\d{2}:\d{2})$/.test(s)?s:s+'+08:00'}).pipe(z.iso.datetime({offset:true}));
const data=z.object({id:Id.optional(),version:Id.optional(),customer_name:z.string().trim().min(1).max(100),customer_phone:z.string().max(40).nullable().default(null),room_id:Id.nullable().default(null),technician_id:Id.nullable().default(null),reserve_time:ReservationTime,people:z.number().int().min(1).max(1000).default(1),duration:z.number().int().min(1).max(1440).default(60),remark:z.string().max(2000).nullable().default(null)}).strict();
reservationsRouter.get('/reservation-staff',merchantRoute({...access,support:'read'},async(_req,actor)=>(await tenantQuery(`SELECT u.id,u.name FROM merchant_users u WHERE u.active=1 AND (u.role='owner' OR EXISTS(SELECT 1 FROM staff_store_grants g WHERE g.merchant_id=u.merchant_id AND g.user_id=u.id AND g.store_id=$1)) ORDER BY u.name,u.id`,[actor.storeId])).rows));
reservationsRouter.get('/reservations',merchantRoute({store:true,roles:['manager','floor','technician'],support:'read'},async(req,actor)=>{
 const q=z.object({status:z.enum(['','all','pending','arrived','completed','cancelled']).default('all'),limit:z.coerce.number().int().min(1).max(500).default(200)}).parse(req.query);
 const rows=(await tenantQuery(`SELECT rv.*,rm.room_no,rm.room_name,t.name AS technician_name,u.name AS staff_name,
 (SELECT o.id FROM orders o WHERE o.reservation_id=rv.id AND o.merchant_id=rv.merchant_id) AS order_id
 FROM reservations rv LEFT JOIN rooms rm ON rm.merchant_id=rv.merchant_id AND rm.id=rv.room_id LEFT JOIN technicians t ON t.merchant_id=rv.merchant_id AND t.id=rv.technician_id LEFT JOIN merchant_users u ON u.merchant_id=rv.merchant_id AND u.id=rv.staff_id
 WHERE rv.store_id=$1 AND rv.status<>'deleted' AND ($2::text IS NULL OR rv.status=$2) AND ($3::bigint IS NULL OR rv.technician_id=$3) ORDER BY rv.reserve_time,rv.id LIMIT $4`,[actor.storeId,['','all'].includes(q.status)?null:q.status,actor.role==='technician'?actor.technicianId:null,q.limit])).rows;
 return actor.role==='technician'?rows.map(({customer_phone,deposit,deposit_required,payment_status,public_token,request_key,...row})=>row):rows.map(({public_token,request_key,...row})=>row);
}));
reservationsRouter.post('/reservations',merchantRoute({...access,write:true},async(req,actor)=>idempotent(req,'reservations.save',async()=>{
 const b=data.parse(input(req));await schedulingLock();const old=b.id?await reservationLock(b.id,b.version):null;
 if(old){ensure(b.version,400,'VERSION_REQUIRED','编辑预约需要版本号');ensure(['pending','arrived'].includes(old.status),409,'RESERVATION_STATE','已结束的预约不能编辑');ensure(!(await tenantQuery('SELECT 1 FROM orders WHERE reservation_id=$1',[old.id])).rowCount,409,'RESERVATION_OPENED','已开房预约不能修改客户或资源')}
 await validateReservationResources(b);
 const values=[b.customer_name,b.customer_phone,b.room_id,b.technician_id,b.reserve_time,b.people,b.duration,b.remark];
 const row=old?(await tenantQuery('UPDATE reservations SET customer_name=$1,customer_phone=$2,room_id=$3,technician_id=$4,reserve_time=$5,people=$6,duration=$7,remark=$8,version=version+1 WHERE id=$9 RETURNING id',[...values,old.id])).rows[0]:(await tenantQuery('INSERT INTO reservations(customer_name,customer_phone,room_id,technician_id,reserve_time,people,duration,remark,store_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[...values,actor.storeId])).rows[0];
 for(const room of new Set<number|null>([old?.room_id??null,b.room_id]))await syncReservationRoom(room);
 await audit('reservation.saved',b,'reservation',row.id);await event('reservation.changed',row.id);return reservationDetail(row.id);
})));
reservationsRouter.post('/reservations/:id/status',merchantRoute({...access,write:true},async req=>idempotent(req,'reservations.status:'+req.params.id,async()=>{
 const b=z.object({version:Id,status:z.enum(['arrived','cancelled'])}).strict().parse(input(req));await schedulingLock();const row=await reservationLock(Id.parse(req.params.id),b.version);
 ensure(['pending','arrived'].includes(row.status),409,'RESERVATION_STATE','预约已结束');ensure(!(await tenantQuery('SELECT 1 FROM orders WHERE reservation_id=$1',[row.id])).rowCount,409,'RESERVATION_OPENED','已开房预约请在订单中处理');
 if(b.status==='cancelled')ensure(row.deposit===0&&row.payment_status!=='pending',409,'BOOKING_REFUND_REQUIRED','有订金或在途支付，请先处理支付取消或退款');
 await tenantQuery("UPDATE reservations SET status=$1,version=version+1,cancelled_at=CASE WHEN $1='cancelled' THEN now() ELSE cancelled_at END WHERE id=$2",[b.status,row.id]);await syncReservationRoom(row.room_id);await audit('reservation.status',b,'reservation',row.id);await event('reservation.changed',row.id);if(b.status==='cancelled')await offerWaitlist(row);return reservationDetail(row.id);
})));
reservationsRouter.post('/reservations/:id/staff',merchantRoute({...access,write:true},async req=>idempotent(req,'reservations.staff:'+req.params.id,async()=>{
 const b=z.object({version:Id,staff_id:Id.nullable()}).strict().parse(input(req));const row=await reservationLock(Id.parse(req.params.id),b.version);ensure(['pending','arrived'].includes(row.status),409,'RESERVATION_STATE','预约已结束');ensure(!(await tenantQuery("SELECT 1 FROM orders WHERE reservation_id=$1 AND status='closed'",[row.id])).rowCount,409,'RESERVATION_SETTLED','已结账的订房归属不能直接调整');await validateStaff(b.staff_id);
 await tenantQuery('UPDATE reservations SET staff_id=$1,version=version+1 WHERE id=$2',[b.staff_id,row.id]);await audit('reservation.staff',b,'reservation',row.id);await event('reservation.changed',row.id);return reservationDetail(row.id);
})));
reservationsRouter.post('/reservations/:id/arrive-open',merchantRoute({...access,write:true},async req=>idempotent(req,'reservations.open:'+req.params.id,async()=>{const b=z.object({version:Id}).strict().parse(input(req));return openReservation(Id.parse(req.params.id),b.version)})));
reservationsRouter.delete('/reservations/:id',merchantRoute({...access,write:true},async req=>idempotent(req,'reservations.archive:'+req.params.id,async()=>{
 const b=z.object({version:Id}).strict().parse(input(req));await schedulingLock();const row=await reservationLock(Id.parse(req.params.id),b.version);ensure(row.status==='cancelled',409,'CANCEL_RESERVATION_FIRST','请先取消预约后再归档');
 await tenantQuery("UPDATE reservations SET status='deleted',version=version+1 WHERE id=$1",[row.id]);await syncReservationRoom(row.room_id);await audit('reservation.archived',{},'reservation',row.id);await event('reservation.changed',row.id);return {id:row.id,archived:true};
})));
