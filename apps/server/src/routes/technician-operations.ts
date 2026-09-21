import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,input,idempotent,canonical} from '../business.js';
import {digest} from '../security.js';
import {ensure} from '../errors.js';
import {businessDate,DateOnly,Month,monthRange} from '../services/dates.js';
export const technicianOperationsRouter=Router();
technicianOperationsRouter.get('/technicians/queue',merchantRoute({store:true,roles:['manager','floor','technician'],support:'read'},async(_req,a)=>{
 return (await tenantQuery(`SELECT t.id,t.name,t.code,t.level,t.status,t.queue_position,
 (SELECT count(*) FROM order_items oi WHERE oi.technician_id=t.id AND oi.is_refund=0 AND oi.clock_in_at>=date_trunc('day',now())) AS assigned_today,
 (SELECT coalesce(sum(oi.quantity),0) FROM order_items oi WHERE oi.technician_id=t.id AND oi.item_type='service' AND oi.status='done' AND oi.is_refund=0 AND oi.clock_out_at>=current_date AND oi.clock_out_at<current_date+1) AS served_today,
 (SELECT count(*)::int FROM reservations rv WHERE rv.technician_id=t.id AND rv.status IN('pending','arrived') AND rv.reserve_time>=current_date AND rv.reserve_time<current_date+1) AS reserved_today
 FROM technicians t WHERE t.store_id=$1 AND t.active=1 AND ($2::bigint IS NULL OR t.id=$2) ORDER BY CASE WHEN t.status='on' THEN 0 WHEN t.status='rest' THEN 1 ELSE 2 END,assigned_today,t.queue_position,t.id`,[a.storeId,a.role==='technician'?a.technicianId:null])).rows;
}));
technicianOperationsRouter.get('/technicians/queue-order',merchantRoute({store:true,roles:['manager'],support:'read'},async(_req,a)=>{
 const rows=(await tenantQuery('SELECT id,name,code,queue_position FROM technicians WHERE store_id=$1 AND active=1 ORDER BY queue_position,id',[a.storeId])).rows;return {rows,version:digest(canonical(rows.map(r=>[r.id,r.queue_position])))};
}));
technicianOperationsRouter.post('/technicians/queue-order',merchantRoute({store:true,write:true,roles:['manager']},async(req,a)=>idempotent(req,'technician.queue-order',async()=>{
 const b=z.object({ids:z.array(Id).min(1).max(1000),reason:z.string().trim().min(2).max(300).optional(),version:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(input(req));
 const rows=(await tenantQuery('SELECT id,queue_position FROM technicians WHERE store_id=$1 AND active=1 ORDER BY queue_position,id FOR UPDATE',[a.storeId])).rows;
 ensure(b.version===digest(canonical(rows.map(r=>[r.id,r.queue_position]))),409,'QUEUE_CHANGED','技师队列已变化，请刷新后重新排序');ensure(new Set(b.ids).size===rows.length&&b.ids.length===rows.length&&rows.every(r=>b.ids.includes(r.id)),400,'INVALID_QUEUE','排序必须恰好包含当前门店全部启用技师');
 for(const [position,id] of b.ids.entries())await tenantQuery('UPDATE technicians SET queue_position=$1 WHERE id=$2 AND store_id=$3',[position+1,id,a.storeId]);await audit('technician.queue_order',{...b,before:rows.map(r=>r.id),reason:b.reason??'旧客户端未填写原因'});await event('technicians.changed');return {ids:b.ids};
})));
technicianOperationsRouter.get('/technicians/queue-history',merchantRoute({store:true,roles:['manager'],support:'read'},async(_req,a)=>{
 return (await tenantQuery("SELECT e.id,e.created_at,e.detail,u.name AS operator_name FROM audit_events e LEFT JOIN merchant_users u ON u.merchant_id=e.merchant_id AND u.id=e.user_id WHERE e.store_id=$1 AND e.action='technician.queue_order' ORDER BY e.id DESC LIMIT 30",[a.storeId])).rows;
}));
technicianOperationsRouter.get('/attendance',merchantRoute({store:true,roles:['manager','technician'],support:'read'},async(req,a)=>{
 const date=DateOnly.parse(req.query.date||businessDate());return (await tenantQuery(`SELECT at.*,t.name,t.code FROM attendance at JOIN technicians t ON t.merchant_id=at.merchant_id AND t.id=at.technician_id WHERE at.store_id=$1 AND at.date=$2 AND ($3::bigint IS NULL OR at.technician_id=$3) ORDER BY at.id`,[a.storeId,date,a.role==='technician'?a.technicianId:null])).rows;
}));
technicianOperationsRouter.get('/attendance/monthly',merchantRoute({store:true,roles:['manager','technician'],support:'read'},async(req,a)=>{
 const month=Month.parse(req.query.month||businessDate().slice(0,7)),range=monthRange(month);
 return (await tenantQuery(`SELECT t.id,t.name,t.code,t.level,count(DISTINCT at.date)::int AS work_days,coalesce(round(sum(greatest(0,extract(epoch FROM(at.clock_out_at-at.clock_in_at))/60)) FILTER(WHERE at.clock_out_at IS NOT NULL)),0)::int AS total_minutes,count(at.id) FILTER(WHERE at.clock_out_at IS NULL)::int AS open_sessions
 FROM technicians t LEFT JOIN attendance at ON at.merchant_id=t.merchant_id AND at.technician_id=t.id AND at.date >=$2 AND at.date <=$3 WHERE t.store_id=$1 AND ($4::bigint IS NULL OR t.id=$4) GROUP BY t.id ORDER BY total_minutes DESC,t.id`,[a.storeId,range.start,range.end,a.role==='technician'?a.technicianId:null])).rows;
}));
