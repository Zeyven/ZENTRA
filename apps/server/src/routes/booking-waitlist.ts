import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,idempotent,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {schedulingLock} from '../services/reservations.js';
import {offerWaitlist} from '../services/public-booking.js';
export const bookingWaitlistRouter=Router();
const read={store:true,roles:['manager','floor'],support:'read' as const},write={store:true,roles:['manager','floor'],write:true};
bookingWaitlistRouter.get('/booking-waitlist',merchantRoute(read,async(req,actor)=>{const before=req.query.before?Id.parse(req.query.before):null;return (await tenantQuery('SELECT w.id,w.version,w.customer_name,w.customer_phone,w.preferred_start,w.preferred_end,w.people,w.status,w.expires_at,w.offered_reservation_id,i.name AS service_name,t.name AS technician_name FROM booking_waitlist w LEFT JOIN items i ON i.merchant_id=w.merchant_id AND i.id=w.service_item_id LEFT JOIN technicians t ON t.merchant_id=w.merchant_id AND t.id=w.technician_id WHERE w.store_id=$1 AND ($2::bigint IS NULL OR w.id<$2) ORDER BY w.id DESC LIMIT 100',[actor.storeId,before])).rows}));
bookingWaitlistRouter.post('/booking-waitlist/scan',merchantRoute(write,async(req,actor)=>idempotent(req,'waitlist.scan',async()=>{await schedulingLock();await offerWaitlist();return {offered:(await tenantQuery("SELECT count(*)::int n FROM booking_waitlist WHERE store_id=$1 AND status='offered'",[actor.storeId])).rows[0].n}})));
bookingWaitlistRouter.post('/booking-waitlist/:id/cancel',merchantRoute(write,async(req,actor)=>idempotent(req,'waitlist.cancel:'+req.params.id,async()=>{
 const b=z.object({version:Id,reason:z.string().trim().min(1).max(500)}).strict().parse(req.body);await schedulingLock();const row=await storeObject('booking_waitlist',Id.parse(req.params.id),actor.storeId!,true);ensure(row.version===b.version&&['waiting','offered'].includes(row.status),409,'WAITLIST_CHANGED','候补状态已变化，请刷新核对');
 if(row.offered_reservation_id)await tenantQuery("UPDATE reservations SET status='cancelled',cancelled_at=now(),version=version+1 WHERE id=$1 AND status='offered'",[row.offered_reservation_id]);const updated=(await tenantQuery("UPDATE booking_waitlist SET status='cancelled',version=version+1 WHERE id=$1 RETURNING id,status,version",[row.id])).rows[0];await audit('booking.waitlist.cancelled',{reason:b.reason},'booking_waitlist',row.id);await event('booking.waitlist.changed',row.id);await offerWaitlist();return updated;
})));
