import {Router} from 'express';
import {postingShift,postEntry} from '../services/shifts.js';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {audit,event,merchantRoute} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,PositiveMoney,idempotent,input,money,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {lockOrder,recalculate,releaseTechnicians,session} from '../services/orders.js';
import {lockMember} from '../services/wallet.js';
import {reverseStock} from '../services/inventory.js';
import {approvalGate,approvalPhase} from '../services/approvals.js';
export const orderActionsRouter=Router();
const base={write:true,store:true,roles:['manager','floor']};
const version=z.object({version:Id});const reason=z.string().trim().min(1).max(500);
const sessionActions={
 'bind-member':version.extend({member_id:Id.nullable(),customer_name:z.string().max(100).optional()}),
 'change-room':version.extend({room_id:Id}),
 discount:version.extend({discount:PositiveMoney,reason,approval_id:Id.optional()}),
 suspend:version,
 resume:version.extend({room_id:Id.optional()}),
 cancel:version.extend({reason}),
 'refund-deposit':version.extend({reason,approval_id:Id.optional()})
};
for(const [action,shape] of Object.entries(sessionActions)){
 orderActionsRouter.post('/sessions/:id/'+action,merchantRoute({...base,...(action==='discount'?{action:'discount'}:action==='cancel'?{action:'cancel'}:action==='refund-deposit'?{action:'refund'}:{})},async(req,actor)=>idempotent(req,'sessions.'+action+':'+req.params.id+approvalPhase(req),async()=>{
  const body:any=shape.strict().parse(input(req));const id=Id.parse(req.params.id);
  const shift=action==='refund-deposit'?await postingShift():null;
  const order=action==='refund-deposit'?await storeObject('orders',id,actor.storeId!,true):await lockOrder(id,body.version,action==='resume'?'suspended':'open');
  ensure(order.version===body.version,409,'STALE_ORDER','订单已更新，请刷新后重试');
  if(action==='bind-member'){
   if(body.member_id)await lockMember(body.member_id);
   ensure(!order.discount_detail,409,'DISCOUNT_BOUND','请先取消已关联的优惠券再更换会员');
   await tenantQuery('UPDATE orders SET member_id=$1,customer_name=coalesce($2,customer_name),version=version+1 WHERE id=$3',[body.member_id,body.customer_name??null,id]);
  }
  if(action==='change-room'||action==='resume'){
   const targetId=body.room_id??order.room_id;ensure(targetId,400,'ROOM_REQUIRED','请选择目标房间');
   const room=await storeObject('rooms',targetId,actor.storeId!,true);ensure(room.status==='idle'&&room.active===1,409,'ROOM_BUSY','目标房间不可用');
   if(order.wristband_no){const band=(await tenantQuery('SELECT * FROM wristbands WHERE store_id=$1 AND code=$2 FOR UPDATE',[actor.storeId,order.wristband_no])).rows[0];ensure(band?.active===1&&(!band.room_id||band.room_id===targetId),409,'WRISTBAND_ROOM_MISMATCH','固定手牌与目标房间不一致');if(action==='resume')ensure(band.status==='idle',409,'WRISTBAND_BUSY','手牌已被其他账单占用')}
   if(action==='change-room'&&order.room_id)await tenantQuery("UPDATE rooms SET status='cleaning' WHERE id=$1",[order.room_id]);
   await tenantQuery("UPDATE orders SET room_id=$1,status='open',version=version+1 WHERE id=$2",[targetId,id]);await tenantQuery("UPDATE rooms SET status='occupied' WHERE id=$1",[targetId]);
   if(order.wristband_no)await tenantQuery("UPDATE wristbands SET status='used' WHERE store_id=$1 AND code=$2",[actor.storeId,order.wristband_no]);
  }
  if(action==='discount'){
   ensure(body.discount<=order.subtotal,400,'DISCOUNT_EXCEEDS_TOTAL','优惠金额不能超过原价');ensure(!order.discount_detail,409,'COUPON_DISCOUNT_ACTIVE','请先撤销优惠券再修改手工优惠');
   const {approval_id,...operation}=body;const pending=await approvalGate(req,{action:'discount',amount:Math.max(0,body.discount-order.discount),targetType:'order',targetId:id,before:{version:order.version,discount:order.discount,subtotal:order.subtotal},operation,reason:body.reason,approvalId:approval_id});if(pending)return pending;
   await tenantQuery('UPDATE orders SET discount=$1,payable=subtotal-$1,version=version+1 WHERE id=$2',[body.discount,id]);
  }
  if(action==='suspend'||action==='cancel'){
   if(action==='cancel'){
    ensure(order.booking_deposit===0,409,'BOOKING_DEPOSIT_PENDING','请先通过预约退款处理已到账订金');
    const items=(await tenantQuery('SELECT * FROM order_items WHERE order_id=$1 AND is_refund=0 ORDER BY id FOR UPDATE',[id])).rows;
    for(const item of items)if(item.inventory_movement_id)await reverseStock(item.inventory_movement_id,'订单取消退回商品');
    await tenantQuery('UPDATE coupons SET status=$1,used_order_id=NULL,used_discount_amount=0,used_at=NULL WHERE used_order_id=$2',['unused',id]);
   }
   await tenantQuery(`UPDATE orders SET status=$1,closed_at=${action==='cancel'?'now()':'NULL'},version=version+1 WHERE id=$2`,[action==='cancel'?'cancelled':'suspended',id]);
   await tenantQuery("UPDATE order_items SET status='done',clock_out_at=coalesce(clock_out_at,now()),clock_paused_at=NULL WHERE order_id=$1 AND status='active'",[id]);await releaseTechnicians(id);
   if(order.room_id)await tenantQuery('UPDATE rooms SET status=$1 WHERE id=$2',[action==='cancel'?'cleaning':'idle',order.room_id]);
   if(order.wristband_no)await tenantQuery("UPDATE wristbands SET status='idle' WHERE store_id=$1 AND code=$2",[actor.storeId,order.wristband_no]);
  }
  if(action==='refund-deposit'){
   ensure(['closed','cancelled'].includes(order.status)&&order.deposit>0&&order.deposit_refunded===0,409,'DEPOSIT_NOT_REFUNDABLE','订单未结束、没有押金或押金已退');
   const {approval_id,...operation}=body;const pending=await approvalGate(req,{action:'refund',amount:order.deposit,targetType:'order',targetId:id,before:{version:order.version,deposit:order.deposit},operation,reason:body.reason,approvalId:approval_id});if(pending)return pending;
   await tenantQuery('UPDATE orders SET deposit_refunded=1,version=version+1 WHERE id=$1',[id]);
   await postEntry(shift,{kind:'deposit_refund',method:'现金',amount:-order.deposit,orderId:id,reason:body.reason});
  }
  await audit('order.'+action,{before:order,request:body},'order',id);await event('session',id);return session(id);
 })));
}
const itemActions={
 refund:version.extend({reason,approval_id:Id.optional()}),gift:version.extend({reason,approval_id:Id.optional()}),price:version.extend({price:PositiveMoney.refine(v=>v>0,'改价必须大于 0，免单请使用赠送'),reason,approval_id:Id.optional()}),
 technician:version.extend({technician_id:Id}), 'add-time':version.extend({minutes:z.number().int().min(1).max(240)}),end:version.extend({reason:reason.optional()})
};
for(const [action,shape] of Object.entries(itemActions)){
 orderActionsRouter.post('/session-items/:id/'+action,merchantRoute({...base,...(['refund','gift','price'].includes(action)?{action:action==='price'?'discount':action}:{})},async(req,actor)=>idempotent(req,'session-items.'+action+':'+req.params.id+approvalPhase(req),async()=>{
  const body:any=shape.strict().parse(input(req)),id=Id.parse(req.params.id);const peek=await storeObject('order_items',id,actor.storeId!);
  const order=await lockOrder(peek.order_id,body.version);const item=await storeObject('order_items',id,actor.storeId!,true);ensure(item.is_refund===0,409,'ITEM_REFUNDED','项目已退单');
  if(['refund','gift','price'].includes(action)){const {approval_id,...operation}=body;const amount=action==='price'?money(new Decimal(item.price).minus(body.price).abs().mul(item.quantity)):item.amount;const pending=await approvalGate(req,{action:action==='refund'?'refund':'discount',amount,targetType:'order_item',targetId:id,before:{order_version:order.version,amount:item.amount},operation,reason:body.reason,approvalId:approval_id});if(pending)return pending}
  if(action==='refund'){
   if(item.inventory_movement_id)await reverseStock(item.inventory_movement_id,'单项退单回库');
   await tenantQuery("UPDATE order_items SET is_refund=1,status='refunded',clock_out_at=now(),clock_paused_at=NULL WHERE id=$1",[id]);
  }
  if(action==='gift')await tenantQuery('UPDATE order_items SET is_gift=1,price=0,amount=0 WHERE id=$1',[id]);
  if(action==='price'){ensure(item.is_gift===0,409,'ITEM_GIFT','赠送项目不能直接改价');await tenantQuery('UPDATE order_items SET price=$1,amount=$2 WHERE id=$3',[body.price,money(new Decimal(body.price).mul(item.quantity).plus(item.add_time_amount)),id])}
  if(action==='technician'){
   ensure(item.item_type==='service'&&item.status==='active',409,'INVALID_SERVICE','只能为进行中的服务更换技师');
   const technician=await storeObject('technicians',body.technician_id,actor.storeId!,true);ensure(technician.active===1&&(technician.status==='on'||technician.id===item.technician_id),409,'TECHNICIAN_BUSY','目标技师不可上钟');
   const skills=(await tenantQuery('SELECT item_id FROM technician_skills WHERE technician_id=$1',[technician.id])).rows;ensure(!skills.length||skills.some(s=>s.item_id===item.item_id),409,'TECHNICIAN_SKILL','目标技师未配置此技能');
   await tenantQuery('UPDATE order_items SET technician_id=$1 WHERE id=$2',[technician.id,id]);await tenantQuery("UPDATE technicians SET status='serving' WHERE id=$1",[technician.id]);
  }
  if(action==='add-time'){
   ensure(item.item_type==='service'&&item.status==='active'&&item.clock_in_at&&item.is_gift===0,409,'INVALID_SERVICE','当前服务不能加钟');
   ensure(item.duration>0,409,'INVALID_DURATION','服务时长无效');const amount=money(new Decimal(item.price).div(item.duration).mul(body.minutes));
   await tenantQuery('UPDATE order_items SET duration=duration+$1,amount=amount+$2,add_time_amount=add_time_amount+$2,add_time_count=add_time_count+1 WHERE id=$3',[body.minutes,amount,id]);
  }
  if(action==='end'){
   ensure(item.status==='active'&&item.clock_in_at,409,'CLOCK_NOT_STARTED','服务尚未起钟或已经结束');
   const remaining=new Date(item.clock_in_at).getTime()+item.duration*60000+item.clock_paused_seconds*1000-Date.now();if(remaining>300000)ensure(body.reason,400,'REASON_REQUIRED','提前下钟需要填写原因');
   await tenantQuery("UPDATE order_items SET status='done',clock_out_at=now(),clock_paused_at=NULL WHERE id=$1",[id]);
  }
  if(item.technician_id)await tenantQuery(`UPDATE technicians t SET status='on' WHERE id=$1 AND status='serving' AND NOT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.merchant_id=oi.merchant_id AND o.id=oi.order_id WHERE oi.technician_id=t.id AND oi.status='active' AND oi.is_refund=0 AND o.status='open')`,[item.technician_id]);
  await recalculate(order.id);await audit('order.item.'+action,{before:item,request:body},'order_item',id);await event('session',order.id);return session(order.id);
 })));
}
orderActionsRouter.post('/order-groups/link',merchantRoute(base,async(req,actor)=>idempotent(req,'order-groups.link',async()=>{
 const body=z.object({order_id:Id,target_order_id:Id}).strict().parse(input(req));ensure(body.order_id!==body.target_order_id,400,'SAME_ORDER','不能与自身联房');
 for(const id of [body.order_id,body.target_order_id].sort((x,y)=>x-y))await lockOrder(id);
 const groups=(await tenantQuery('SELECT * FROM order_groups WHERE order_id=ANY($1::bigint[]) FOR UPDATE',[[body.order_id,body.target_order_id]])).rows;
 ensure(new Set(groups.map(g=>g.group_no)).size<=1,409,'DIFFERENT_GROUPS','订单已经属于不同联房组');const group=groups[0]?.group_no??'G'+randomUUID();
 for(const id of [body.order_id,body.target_order_id])await tenantQuery('INSERT INTO order_groups(store_id,group_no,order_id) VALUES($1,$2,$3) ON CONFLICT(merchant_id,order_id) DO NOTHING',[actor.storeId,group,id]);
 await audit('order.group.linked',body);await event('group-link',group);return {group_no:group};
})));
orderActionsRouter.get('/order-groups/:orderId',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const id=Id.parse(req.params.orderId);await storeObject('orders',id,actor.storeId!);
 return (await tenantQuery('SELECT o.* FROM order_groups g JOIN orders o ON o.merchant_id=g.merchant_id AND o.id=g.order_id WHERE g.group_no=(SELECT group_no FROM order_groups WHERE order_id=$1) AND g.store_id=$2 ORDER BY o.id',[id,actor.storeId])).rows;
}));
orderActionsRouter.delete('/order-groups/:orderId',merchantRoute(base,async(req,actor)=>{
 const id=Id.parse(req.params.orderId);await storeObject('orders',id,actor.storeId!);await tenantQuery('DELETE FROM order_groups WHERE order_id=$1 AND store_id=$2',[id,actor.storeId]);await audit('order.group.unlinked',{},'order',id);await event('group-link',id);return {id};
}));
