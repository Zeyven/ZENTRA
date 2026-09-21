import {clockView} from './clocks.js';
import {context,tenantQuery} from '../db/pools.js';
import {Id,money,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {Decimal} from 'decimal.js';
export async function lockOrder(id:number,version?:number,status='open'){
 const order=await storeObject('orders',id,context().storeId!,true);
 ensure(order.status===status,409,'ORDER_STATUS',status==='open'?'订单已结账、挂单或取消':'订单状态不允许此操作');
 if(version!==undefined)ensure(order.version===version,409,'STALE_ORDER','消费单已在其他设备更新，请刷新后重试');return order;
}
export async function recalculate(orderId:number){
 const subtotal=(await tenantQuery('SELECT coalesce(sum(amount) FILTER(WHERE is_refund=0 AND is_gift=0),0) AS total FROM order_items WHERE order_id=$1',[orderId])).rows[0].total;
 const coupons=(await tenantQuery("SELECT min_amount FROM coupons WHERE used_order_id=$1 AND status='used'",[orderId])).rows;
 ensure(coupons.every(c=>subtotal>=c.min_amount),409,'COUPON_THRESHOLD','调整后金额不满足优惠券门槛，请先撤销用券');
 const order=(await tenantQuery('SELECT discount FROM orders WHERE id=$1',[orderId])).rows[0];
 ensure(!coupons.length||subtotal>=order.discount,409,'COUPON_DISCOUNT_EXCEEDS_TOTAL','优惠券抵扣超过调整后金额，请先撤销用券');
 const discount=Math.min(subtotal,order.discount),payable=money(new Decimal(subtotal).minus(discount));
 await tenantQuery('UPDATE orders SET subtotal=$1,discount=$2,payable=$3,version=version+1 WHERE id=$4',[subtotal,discount,payable,orderId]);
}
export async function orderDetail(id:number){
 // Read the cursor first: a concurrent commit may make the detail newer, never falsely acknowledge an unseen update.
 const cursor=(await tenantQuery('SELECT coalesce(max(id),0) AS cursor FROM domain_events WHERE store_id=$1 OR store_id IS NULL',[context().storeId])).rows[0].cursor;
 const order=await storeObject('orders',id,context().storeId!);
 const items=(await tenantQuery(`SELECT oi.*,t.name AS technician_name,t.code AS technician_code FROM order_items oi LEFT JOIN technicians t
 ON t.merchant_id=oi.merchant_id AND t.store_id=oi.store_id AND t.id=oi.technician_id WHERE oi.order_id=$1 ORDER BY oi.id`,[id])).rows;
 const paymentHistory=(await tenantQuery('SELECT * FROM payments WHERE order_id=$1 ORDER BY id',[id])).rows;
 const room=order.room_id?(await tenantQuery('SELECT * FROM rooms WHERE id=$1',[order.room_id])).rows[0]:null;
 const member=order.member_id?(await tenantQuery('SELECT id,name,card_no,card_type,balance,bonus_balance,times_balance,points,discount,status FROM members WHERE id=$1',[order.member_id])).rows[0]:null;
 return {...order,event_cursor:cursor,items,payments:paymentHistory.filter(p=>!p.reversed_at),payment_history:paymentHistory,room,member,room_no:room?.room_no??null,room_name:room?.room_name??null,member_name:member?.name??null,technician_name:items.find(i=>i.technician_id)?.technician_name??null};
}
export function sessionItem(it:any){const clock=clockView(it);return {id:it.id,type:it.item_type==='service'?'SERVICE':'PRODUCT',service_id:it.item_type==='service'?it.item_id:null,item_id:it.item_id,
 service_name:it.item_type==='service'?it.item_name:null,item_name:it.item_name,quantity:it.quantity,base_price:it.base_price,unit_price:it.price,total:it.amount,
 pricing_detail:it.pricing_detail?JSON.parse(it.pricing_detail):null,technician_id:it.technician_id,technician_name:it.technician_name,technician_no:it.technician_code,
 service_type:it.service_type,status:it.status==='active'?'IN_PROGRESS':'DONE',duration_minutes:it.duration,add_time_count:it.add_time_count,add_time_amount:it.add_time_amount,
 clock_state:clock.state,expected_end_at:clock.expected_end_at,remaining_seconds:clock.remaining_seconds,is_gift:it.is_gift,is_refund:it.is_refund,started_at:it.clock_in_at,ended_at:it.clock_out_at};}
export async function session(id:number){
 const o=await orderDetail(id);
 return {id:o.id,order:o,resource_id:o.room_id,resource_code:o.room_no,resource_name:o.room_name,guest_name:o.customer_name,opened_at:o.opened_at,closed_at:o.closed_at,
 subtotal:o.subtotal,discount:o.discount,total:o.payable,paid:o.paid,booking_deposit:o.booking_deposit,version:o.version,balance_due:money(Math.max(0,o.payable-o.paid)),
 deposit:o.deposit,deposit_refunded:o.deposit_refunded,wristband_no:o.wristband_no,items:o.items.map(sessionItem)};
}
export async function releaseTechnicians(orderId:number){
 await tenantQuery(`UPDATE technicians t SET status='on' WHERE t.id IN(SELECT technician_id FROM order_items WHERE order_id=$1)
 AND t.status='serving' AND NOT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.merchant_id=oi.merchant_id
 WHERE oi.technician_id=t.id AND oi.order_id<>$1 AND oi.status='active' AND oi.is_refund=0 AND o.status IN('open','suspended'))`,[orderId]);
}
