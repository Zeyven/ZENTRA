import {tenantQuery} from '../db/pools.js';
import {event} from '../access.js';
export const clockSelect=`SELECT oi.*,o.room_id,o.version AS order_version,o.status AS order_status,r.room_no,t.name AS technician_name,t.code AS technician_code
 FROM order_items oi JOIN orders o ON o.merchant_id=oi.merchant_id AND o.store_id=oi.store_id AND o.id=oi.order_id
 LEFT JOIN rooms r ON r.merchant_id=o.merchant_id AND r.id=o.room_id LEFT JOIN technicians t ON t.merchant_id=oi.merchant_id AND t.id=oi.technician_id`;
export function clockView(row:any,now=Date.now()){
 const started=row.clock_in_at?new Date(row.clock_in_at).getTime():null,paused=row.clock_paused_at?new Date(row.clock_paused_at).getTime():null;
 const end=started===null?null:started+row.duration*60000+row.clock_paused_seconds*1000,remaining=end===null?null:Math.ceil((end-(paused??now))/1000);
 const state=row.is_refund||row.status==='refunded'?'CANCELLED':row.status!=='active'?'COMPLETED':!row.technician_id?'WAITING':started===null?(row.clock_ready_at?'READY':'ASSIGNED'):paused!==null?'PAUSED':remaining!<=0?'OVERTIME':remaining!<=600?'ENDING_SOON':'IN_SERVICE';
 return {id:row.id,order_id:row.order_id,order_version:row.order_version,room_id:row.room_id,room_no:row.room_no,technician_id:row.technician_id,technician_name:row.technician_name,technician_code:row.technician_code,
 service_name:row.item_name,service_type:row.service_type,duration_minutes:row.duration,state,started_at:started===null?null:new Date(started).toISOString(),expected_end_at:end===null?null:new Date(end).toISOString(),paused_at:row.clock_paused_at,remaining_seconds:remaining};
}
export async function scanClockReminders(){
 const rows=(await tenantQuery(`WITH timing AS (
 SELECT oi.store_id,oi.id,oi.clock_in_at+make_interval(mins=>oi.duration,secs=>oi.clock_paused_seconds) AS expected_end_at
 FROM order_items oi JOIN orders o ON o.merchant_id=oi.merchant_id AND o.id=oi.order_id
 WHERE o.status='open' AND oi.item_type='service' AND oi.status='active' AND oi.is_refund=0 AND oi.clock_in_at IS NOT NULL AND oi.clock_paused_at IS NULL),due AS (
 SELECT *,CASE WHEN expected_end_at<=now()-interval '5 minutes' THEN 'overtime_5' WHEN expected_end_at<=now() THEN 'due' WHEN expected_end_at<=now()+interval '5 minutes' THEN 'before_5' WHEN expected_end_at<=now()+interval '10 minutes' THEN 'before_10' END AS kind FROM timing)
 INSERT INTO clock_reminders(store_id,order_item_id,expected_end_at,kind) SELECT d.store_id,d.id,d.expected_end_at,d.kind FROM due d WHERE d.kind IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM clock_reminders r WHERE r.order_item_id=d.id AND r.expected_end_at=d.expected_end_at AND r.kind=d.kind)
 ON CONFLICT(merchant_id,order_item_id,expected_end_at,kind) DO NOTHING RETURNING store_id,id`)).rows;
 for(const storeId of new Set(rows.map(r=>r.store_id)))await event('clock-reminder',undefined,storeId);
 return rows.length;
}
