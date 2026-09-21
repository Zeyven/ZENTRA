import {randomUUID} from 'node:crypto';
import {context,tenantQuery} from '../db/pools.js';
import {ensure} from '../errors.js';
import {audit,event} from '../access.js';
import {storeObject} from '../business.js';
import {session} from './orders.js';
import {postingShift} from './shifts.js';

// Serialize reservation scheduling before taking resource locks. No transaction holds a
// resource lock while waiting for this lock, so edits moving between rooms stay ordered.
export async function schedulingLock(){const c=context();await tenantQuery('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${c.merchantId}:${c.storeId}:reservations`])}
export async function reservationDetail(id:number){return (await tenantQuery(`SELECT rv.*,rm.room_no,rm.room_name,t.name AS technician_name,u.name AS staff_name,
 (SELECT o.id FROM orders o WHERE o.reservation_id=rv.id AND o.merchant_id=rv.merchant_id) AS order_id
 FROM reservations rv LEFT JOIN rooms rm ON rm.merchant_id=rv.merchant_id AND rm.id=rv.room_id
 LEFT JOIN technicians t ON t.merchant_id=rv.merchant_id AND t.id=rv.technician_id
 LEFT JOIN merchant_users u ON u.merchant_id=rv.merchant_id AND u.id=rv.staff_id WHERE rv.id=$1 AND rv.store_id=$2`,[id,context().storeId])).rows[0]}
export async function reservationLock(id:number,version?:number){const row=await storeObject('reservations',id,context().storeId!,true);if(version!==undefined)ensure(row.version===version,409,'STALE_RESERVATION','预约已被其他终端修改，请刷新后操作');return row}
export async function syncReservationRoom(id:number|null){if(!id)return;await tenantQuery(`UPDATE rooms SET status=CASE WHEN EXISTS(SELECT 1 FROM reservations rv WHERE rv.room_id=rooms.id AND rv.store_id=rooms.store_id AND rv.status='pending') THEN 'reserved' ELSE 'idle' END WHERE id=$1 AND store_id=$2 AND status IN('idle','reserved')`,[id,context().storeId])}
export async function validateStaff(id:number|null){if(!id)return;const row=(await tenantQuery(`SELECT u.id FROM merchant_users u WHERE u.id=$1 AND u.active=1 AND (u.role='owner' OR EXISTS(SELECT 1 FROM staff_store_grants g WHERE g.merchant_id=u.merchant_id AND g.user_id=u.id AND g.store_id=$2))`,[id,context().storeId])).rows[0];ensure(row,400,'INVALID_STAFF','预订员工未获当前门店授权')}
export async function validateReservationResources(input:{id?:number;room_id:number|null;technician_id:number|null;reserve_time:string;duration:number}){
 for(const [table,id] of [['rooms',input.room_id],['technicians',input.technician_id]] as const){if(!id)continue;const row=await storeObject(table,id,context().storeId!,true);ensure(row.active===1,409,'RESOURCE_INACTIVE','预约资源已停用')}
 const clash=(await tenantQuery(`SELECT id FROM reservations WHERE store_id=$1 AND id<>coalesce($2,0) AND status IN('pending','arrived','offered','awaiting_payment')
 AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.reservation_id=reservations.id AND o.merchant_id=reservations.merchant_id)
 AND (($3::bigint IS NOT NULL AND room_id=$3) OR ($4::bigint IS NOT NULL AND technician_id=$4))
 AND reserve_time < $5::timestamptz + make_interval(mins=>$6) AND reserve_time+make_interval(mins=>duration)>$5::timestamptz LIMIT 1`,[context().storeId,input.id??null,input.room_id,input.technician_id,input.reserve_time,input.duration])).rows[0];
 ensure(!clash,409,'RESERVATION_CONFLICT','该时段的房间或技师已有预约');
}
export async function openReservation(id:number,version:number){
 // Match cashier ordering: shift, reservation, room. Cashier and arrival cannot create two live orders.
 await postingShift();await schedulingLock();const rv=await reservationLock(id);
 const existing=(await tenantQuery('SELECT id FROM orders WHERE reservation_id=$1 AND store_id=$2',[id,context().storeId])).rows[0];if(existing)return session(existing.id);
 ensure(rv.version===version,409,'STALE_RESERVATION','预约已被其他终端修改，请刷新后操作');
 ensure(['pending','arrived'].includes(rv.status),409,'RESERVATION_STATE','仅待来店或已到店预约可开房');
 ensure(rv.room_id,400,'ROOM_REQUIRED','请先为预约指定房间');
 ensure(rv.deposit_required===0||rv.payment_status==='paid',409,'BOOKING_UNPAID','预约订金尚未到账');
 const payment=rv.deposit>0?(await tenantQuery("SELECT * FROM booking_payment_orders WHERE reservation_id=$1 AND status='paid' AND applied_order_id IS NULL ORDER BY id LIMIT 1 FOR UPDATE",[id])).rows[0]:null;
 if(rv.deposit>0)ensure(payment&&payment.amount===rv.deposit,409,'BOOKING_LEDGER_MISMATCH','预约订金记录不完整，请先对账');
 const room=await storeObject('rooms',rv.room_id,context().storeId!,true);ensure(room.active===1&&['idle','reserved'].includes(room.status),409,'ROOM_UNAVAILABLE','预约房间尚未空闲');
 const order=(await tenantQuery(`INSERT INTO orders(store_id,order_no,room_id,customer_name,customer_phone,source,reservation_id,booking_deposit,paid,cashier_id) VALUES($1,$2,$3,$4,$5,'reservation',$6,$7,$7,$8) RETURNING id`,[context().storeId,'S'+randomUUID().replaceAll('-','').slice(0,20).toUpperCase(),room.id,rv.customer_name,rv.customer_phone,id,rv.deposit,context().userId])).rows[0];
 if(payment){await tenantQuery(`INSERT INTO payments(store_id,order_id,method,amount,source,reference_no,cashier_id) VALUES($1,$2,$3,$4,'booking',$5,$6)`,[context().storeId,order.id,payment.provider==='wechat'?'微信':'支付宝',payment.amount,payment.payment_no,context().userId]);await tenantQuery('UPDATE booking_payment_orders SET applied_order_id=$1,updated_at=now() WHERE id=$2',[order.id,payment.id])}
 await tenantQuery("UPDATE reservations SET status='arrived',version=version+1 WHERE id=$1",[id]);await tenantQuery("UPDATE rooms SET status='occupied' WHERE id=$1",[room.id]);
 await audit('reservation.opened',{order_id:order.id},'reservation',id);await event('reservation.changed',id);await event('session-open',order.id);return session(order.id);
}
