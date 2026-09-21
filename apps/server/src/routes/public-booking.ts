import {Router} from 'express';
import {z} from 'zod';
import {publicStore,throttle} from './public.js';
import {context,tenantQuery} from '../db/pools.js';
import {Id,idempotent} from '../business.js';
import {ensure} from '../errors.js';
import {randomToken,digest} from '../security.js';
import {audit,event} from '../access.js';
import {PublicBookingInput,bookingQuote,createPublicBooking,publicReservation,bookingView,offerWaitlist} from '../services/public-booking.js';
import {schedulingLock,syncReservationRoom} from '../services/reservations.js';
export const publicBookingRouter=Router();
const scope='/:merchantCode/:storeCode/booking',token=(req:any)=>z.string().regex(/^Bearer [A-Za-z0-9_-]{43}$/).parse(req.headers.authorization).slice(7);
publicBookingRouter.get(scope+'/options',publicStore(false,async(_req,store)=>({store:{name:store.name,code:store.code,available:store.available},services:(await tenantQuery("SELECT id,name,price,duration FROM items WHERE store_id=$1 AND active=1 AND sold_out=0 AND type='service' ORDER BY id",[store.id])).rows,technicians:(await tenantQuery('SELECT id,name,code,level FROM technicians WHERE store_id=$1 AND active=1 ORDER BY queue_position,id',[store.id])).rows,payment_available:false})));
publicBookingRouter.post(scope+'/quote',publicStore(true,async req=>{await schedulingLock();return bookingQuote(PublicBookingInput.parse(req.body))}));
publicBookingRouter.post(scope+'/reservations',publicStore(true,async req=>idempotent(req,'booking.create',async()=>{const body=PublicBookingInput.parse(req.body);await throttle(req);await schedulingLock();return createPublicBooking(body)})));
publicBookingRouter.get(scope+'/reservations/:id',publicStore(false,async req=>bookingView(await publicReservation(Id.parse(req.params.id),token(req)))));
publicBookingRouter.post(scope+'/reservations/:id/payment-order',publicStore(true,async req=>{await publicReservation(Id.parse(req.params.id),token(req));ensure(false,409,'PAYMENT_NOT_CONNECTED','支付服务尚未接入，未创建支付或扣款')}));
publicBookingRouter.post(scope+'/reservations/:id/reschedule',publicStore(true,async req=>{
 const id=Id.parse(req.params.id),bearer=token(req);await publicReservation(id,bearer);
 return idempotent(req,'booking.reschedule:'+id,async()=>{
  const b=z.object({version:Id,reserve_time:z.iso.datetime({offset:true})}).strict().parse(req.body);await schedulingLock();const row=await publicReservation(id,bearer,true);ensure(row.version===b.version,409,'STALE_RESERVATION','预约已变化，请刷新核对');ensure(row.status==='pending'&&row.deposit===0,409,'BOOKING_STATE','仅未产生订金的待来店预约可在线改期');
  const input=PublicBookingInput.parse({customer_name:row.customer_name,customer_phone:row.customer_phone,service_item_id:row.service_item_id,technician_id:row.technician_id,reserve_time:b.reserve_time,people:row.people,remark:row.remark??''});const quote=await bookingQuote(input,id);ensure(quote.deposit_required===0,409,'PAYMENT_NOT_CONNECTED','新时段需要线上订金，请联系门店改期');
  const updated=(await tenantQuery('UPDATE reservations SET reserve_time=$1,room_id=$2,duration=$3,booking_quote=$4,version=version+1 WHERE id=$5 RETURNING *',[b.reserve_time,quote.room_id,quote.duration,JSON.stringify(quote),id])).rows[0];await syncReservationRoom(row.room_id);await audit('booking.rescheduled',{before:row.reserve_time,after:b.reserve_time},'reservation',id);await event('reservation.changed',id);return bookingView(updated);
 });
}));
publicBookingRouter.post(scope+'/reservations/:id/cancel',publicStore(true,async req=>{
 const id=Id.parse(req.params.id),bearer=token(req);await publicReservation(id,bearer);
 return idempotent(req,'booking.cancel:'+id,async()=>{const b=z.object({version:Id}).strict().parse(req.body);await schedulingLock();const row=await publicReservation(id,bearer,true);ensure(row.version===b.version,409,'STALE_RESERVATION','预约已变化，请刷新核对');ensure(['pending','offered'].includes(row.status)&&row.deposit===0,409,'BOOKING_STATE','已到店或存在订金的预约请联系门店处理');
  const updated=(await tenantQuery("UPDATE reservations SET status='cancelled',cancelled_at=now(),version=version+1 WHERE id=$1 RETURNING *",[id])).rows[0];await tenantQuery("UPDATE booking_waitlist SET status='cancelled',version=version+1 WHERE offered_reservation_id=$1",[id]);await syncReservationRoom(row.room_id);await audit('booking.cancelled',{},'reservation',id);await event('reservation.changed',id);await offerWaitlist(row);return bookingView(updated);
 });
}));
publicBookingRouter.post(scope+'/waitlist',publicStore(true,async req=>idempotent(req,'booking.waitlist',async()=>{
 const b=PublicBookingInput.extend({preferred_end:z.iso.datetime({offset:true}).optional()}).parse(req.body);ensure(!b.preferred_end||Date.parse(b.preferred_end)>=Date.parse(b.reserve_time)&&Date.parse(b.preferred_end)-Date.parse(b.reserve_time)<=86400000,400,'INVALID_RANGE','候补时间范围须在 24 小时内');await throttle(req);await schedulingLock();
 try{await bookingQuote(b)}catch(e){if((e as any)?.code!=='BOOKING_FULL')throw e}
 const bearer=randomToken(),row=(await tenantQuery('INSERT INTO booking_waitlist(store_id,customer_name,customer_phone,service_item_id,technician_id,preferred_start,preferred_end,people,public_token) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,status,version',[context().storeId,b.customer_name,b.customer_phone,b.service_item_id,b.technician_id,b.reserve_time,b.preferred_end??null,b.people,digest(bearer)])).rows[0];await audit('booking.waitlisted',{waitlist_id:row.id},'booking_waitlist',row.id);await event('booking.waitlist.changed',row.id);return {...row,token:bearer};
})));
publicBookingRouter.get(scope+'/waitlist/:id',publicStore(false,async req=>{const row=(await tenantQuery('SELECT id,status,version,preferred_start,preferred_end,expires_at,offered_reservation_id FROM booking_waitlist WHERE id=$1 AND store_id=$2 AND public_token=$3',[Id.parse(req.params.id),context().storeId,digest(token(req))])).rows[0];ensure(row,404,'NOT_FOUND','候补凭据无效');return row}));
publicBookingRouter.post(scope+'/reservations/:id/confirm',publicStore(true,async req=>{
 const id=Id.parse(req.params.id),bearer=token(req);await publicReservation(id,bearer);
 return idempotent(req,'booking.confirm:'+id,async()=>{const b=z.object({version:Id}).strict().parse(req.body);await schedulingLock();const row=await publicReservation(id,bearer,true);ensure(row.version===b.version&&row.status==='offered',409,'BOOKING_STATE','候补名额已变化，请刷新核对');
  const offer=(await tenantQuery("SELECT id FROM booking_waitlist WHERE offered_reservation_id=$1 AND status='offered' AND expires_at>now() FOR UPDATE",[id])).rows[0];ensure(offer,409,'OFFER_EXPIRED','候补确认已超时');const updated=(await tenantQuery("UPDATE reservations SET status='pending',version=version+1 WHERE id=$1 RETURNING *",[id])).rows[0];await tenantQuery("UPDATE booking_waitlist SET status='converted',version=version+1 WHERE id=$1",[offer.id]);await audit('booking.confirmed',{},'reservation',id);await event('reservation.changed',id);return bookingView(updated);
 });
}));
