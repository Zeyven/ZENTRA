import {updateMemberLevel} from '../services/member-levels.js';
import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,PositiveMoney,input,idempotent,storeObject,money,sum} from '../business.js';
import {ensure} from '../errors.js';
import {credit,debit,lockMember,reverseAssets} from '../services/wallet.js';
import {stockMove,consumeMaterials,reverseStock} from '../services/inventory.js';
import {lockOrder,orderDetail,recalculate,releaseTechnicians,session,sessionItem} from '../services/orders.js';
import {calculatePrice} from '../services/pricing-engine.js';
import {postingShift,postEntry,reverseOrderEntries} from '../services/shifts.js';
import {approvalGate,approvalPhase} from '../services/approvals.js';
export const cashierRouter=Router();
const cashAccess={write:true,store:true,roles:['manager','floor']};
const methods=z.enum(['现金','微信','支付宝','银行卡','美团','抖音','会员卡']);
const localTime=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
cashierRouter.post('/sessions',merchantRoute(cashAccess,async(req,actor)=>idempotent(req,'sessions.open',async()=>{
 const body=z.object({resource_id:Id,guest_name:z.string().max(100).optional(),customer_id:Id.nullable().optional(),wristband_no:z.string().max(100).optional(),deposit:PositiveMoney.optional()}).strict().parse(input(req));
 const shift=await postingShift();
 const room=await storeObject('rooms',body.resource_id,actor.storeId!,true);ensure(room.active===1&&room.status==='idle',409,'ROOM_UNAVAILABLE','房间非空闲或已停用');
 if(body.customer_id)await lockMember(body.customer_id);
 let band:any;if(body.wristband_no){band=(await tenantQuery('SELECT * FROM wristbands WHERE store_id=$1 AND code=$2 FOR UPDATE',[actor.storeId,body.wristband_no])).rows[0];ensure(band?.active===1&&band.status==='idle',409,'WRISTBAND_UNAVAILABLE','手牌不存在或正在使用');ensure(!band.room_id||band.room_id===room.id,409,'WRISTBAND_ROOM_MISMATCH','手牌固定绑定其他房间')}
 const deposit=body.deposit??band?.deposit??0;
 const order=(await tenantQuery(`INSERT INTO orders(store_id,order_no,room_id,customer_name,member_id,wristband_no,deposit,cashier_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[actor.storeId,'S'+randomUUID().replaceAll('-','').slice(0,20).toUpperCase(),room.id,body.guest_name??null,body.customer_id??null,body.wristband_no??null,deposit,actor.user.id])).rows[0];
 await tenantQuery("UPDATE rooms SET status='occupied' WHERE id=$1",[room.id]);if(band)await tenantQuery("UPDATE wristbands SET status='used' WHERE id=$1",[band.id]);
 if(deposit>0)await postEntry(shift,{kind:'deposit',method:'现金',amount:deposit,orderId:order.id,reason:'开房收取押金'});
 await audit('order.opened',{room_id:room.id,deposit},'order',order.id);await event('session-open',order.id);return session(order.id);
})));
cashierRouter.post('/sessions/:id/items',merchantRoute(cashAccess,async(req,actor)=>idempotent(req,'sessions.items:'+req.params.id,async()=>{
 const body=z.object({catalog_id:Id,quantity:z.number().positive().max(100000).default(1),technician_id:Id.nullable().optional(),service_type:z.enum(['轮钟','点钟','加钟','半钟','排钟']).default('轮钟'),type:z.enum(['SERVICE','PRODUCT']).optional(),version:Id}).strict().parse(input(req));
 ensure(new Decimal(body.quantity).decimalPlaces()<=3,400,'INVALID_QUANTITY','数量最多保留三位小数');
 const order=await lockOrder(Id.parse(req.params.id),body.version);const item=await storeObject('items',body.catalog_id,actor.storeId!,true);
 ensure(item.active===1&&item.sold_out===0,409,'ITEM_UNAVAILABLE','项目或商品已停售');
 const service=item.type==='service';if(service)ensure(Number.isSafeInteger(body.quantity),400,'SERVICE_QUANTITY_INTEGER','服务次数必须为整数');let tech:any;
 if(service){
  if(body.technician_id)tech=await storeObject('technicians',body.technician_id,actor.storeId!,true);
  else{
   ensure(body.service_type==='轮钟',400,'TECHNICIAN_REQUIRED','请指定服务技师');
   tech=(await tenantQuery(`SELECT t.*,(SELECT count(*) FROM order_items oi WHERE oi.technician_id=t.id AND oi.is_refund=0 AND oi.clock_in_at>=date_trunc('day',now())) AS assigned_today FROM technicians t WHERE t.store_id=$1 AND t.active=1 AND t.status='on'
   AND (NOT EXISTS(SELECT 1 FROM technician_skills sk WHERE sk.technician_id=t.id) OR EXISTS(SELECT 1 FROM technician_skills sk WHERE sk.technician_id=t.id AND sk.item_id=$2))
   ORDER BY (SELECT count(*) FROM order_items oi WHERE oi.technician_id=t.id AND oi.is_refund=0 AND oi.clock_in_at>=date_trunc('day',now())),t.queue_position,t.id
   LIMIT 1 FOR UPDATE OF t SKIP LOCKED`,[actor.storeId,item.id])).rows[0];
  }
  ensure(tech?.active===1&&tech.status==='on',409,'TECHNICIAN_UNAVAILABLE','暂无可上钟技师，或所选技师不在可上钟状态');
  const skills=(await tenantQuery('SELECT item_id FROM technician_skills WHERE technician_id=$1',[tech.id])).rows;
  ensure(!skills.length||skills.some(s=>s.item_id===item.id),409,'TECHNICIAN_SKILL','技师未配置此项目的技能');
 }
 const room=order.room_id?await storeObject('rooms',order.room_id,actor.storeId!):null;
 const member=order.member_id?await lockMember(order.member_id):null;
 const pricing=calculatePrice({basePrice:item.price,rules:(await tenantQuery('SELECT * FROM pricing_rules WHERE store_id=$1 AND enabled=1 ORDER BY priority,id',[actor.storeId])).rows,
 context:{at:localTime(),item_id:item.id,room_type:room?.room_type,technician_level:tech?.level,member_level:member?.level}});
 const movement=!service?await stockMove(item.id,-body.quantity,'订单商品出库','order',order.id):null;
 const confirmation=service&&(await tenantQuery("SELECT value FROM settings WHERE store_id=$1 AND key='clock_confirmation_mode'",[actor.storeId])).rows[0]?.value==='1';
 await tenantQuery(`INSERT INTO order_items(store_id,order_id,item_id,item_name,item_type,quantity,base_price,price,amount,pricing_detail,technician_id,clock_in_at,duration,service_type,inventory_movement_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[actor.storeId,order.id,item.id,item.name,item.type,body.quantity,pricing.base_price,pricing.final_price,money(new Decimal(pricing.final_price).mul(body.quantity)),JSON.stringify(pricing),tech?.id??null,service&&!confirmation?new Date():null,item.duration,service?body.service_type:null,movement?.id??null]);
 if(tech)await tenantQuery("UPDATE technicians SET status='serving' WHERE id=$1",[tech.id]);await recalculate(order.id);
 await audit('order.item.added',{item_id:item.id,quantity:body.quantity,technician_id:tech?.id,assignment:service?{mode:body.technician_id?'manual':'automatic',rule:body.technician_id?'操作员指定技师':'在岗且技能匹配，今日已接单数优先，其次人工顺序；并发占用跳过',assigned_today:tech?.assigned_today??null,queue_position:tech?.queue_position}:null},'order',order.id);await event('session',order.id);return session(order.id);
})));
cashierRouter.post('/sessions/:id/checkout',merchantRoute({...cashAccess,action:'settle'},async(req,actor)=>idempotent(req,'sessions.checkout:'+req.params.id,async()=>{
 const body=z.object({version:Id,payments:z.array(z.object({method:methods,amount:PositiveMoney.refine(v=>v>0),voucher_code:z.string().trim().min(1).max(100).optional()}).strict()).max(20)}).strict().parse(input(req));
 const shift=await postingShift();
 const order=await lockOrder(Id.parse(req.params.id),body.version);
 const items=(await tenantQuery('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id FOR UPDATE',[order.id])).rows;
 ensure(items.length,400,'EMPTY_ORDER','请先添加消费项目');
 const services=items.filter(i=>i.item_type==='service'&&i.is_refund===0&&i.is_gift===0);
 ensure(services.every(i=>i.technician_id&&i.clock_in_at&&!i.clock_paused_at),409,'CLOCK_UNFINISHED','请处理未派钟、未确认上钟或暂停的服务');
 const due=new Decimal(order.payable).minus(order.booking_deposit);ensure(due.gte(0)&&sum(body.payments.map(p=>p.amount)).equals(due),400,'PAYMENT_MISMATCH','支付合计与扣除预约订金后的应收金额不一致');
 const card=body.payments.filter(p=>p.method==='会员卡');ensure(card.length<=1,400,'DUPLICATE_CARD_PAYMENT','会员卡支付请合并为一条');
 const effects:{version:number;asset_operations:number[];material_movements:number[];payment_ids:number[];member_id:number|null}={version:2,asset_operations:[],material_movements:[],payment_ids:[],member_id:order.member_id};
 let member=order.member_id?await lockMember(order.member_id):null;
 let debitOperation:number|undefined;
 if(card.length){
  ensure(member,400,'MEMBER_REQUIRED','会员卡支付需要先绑定会员');
  if(member.card_type==='times')ensure(body.payments.length===1&&services.length>0&&items.filter(i=>i.is_refund===0&&i.is_gift===0).every(i=>i.item_type==='service'),400,'TIMES_CARD_SERVICES_ONLY','次卡按整单服务扣次，请将商品或其他支付拆单处理');
  const debited=await debit(member.id,member.card_type==='times'?0:card[0].amount,'订单结账',order.id,member.card_type==='times'?services.reduce((count,item)=>count+item.quantity,0):0);
  effects.asset_operations.push(debited.operation.id);debitOperation=debited.operation.id;member=debited.member;
 }
 for(const payment of body.payments){
  if(['美团','抖音'].includes(payment.method))ensure(payment.voucher_code,400,'VOUCHER_REQUIRED','团购支付需要券码');
  const paid=(await tenantQuery('INSERT INTO payments(store_id,order_id,method,amount,voucher_code,cashier_id,asset_operation_id,shift_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[actor.storeId,order.id,payment.method,payment.amount,payment.voucher_code?.toUpperCase()??null,actor.user.id,payment.method==='会员卡'?debitOperation:null,shift?.id??null])).rows[0];effects.payment_ids.push(paid.id);
  await postEntry(shift,{kind:'payment',method:payment.method,amount:payment.amount,orderId:order.id,paymentId:paid.id,reason:'订单结账'});
 }
 effects.material_movements=await consumeMaterials(order.id);
 if(member&&order.payable>0){
  const settings=Object.fromEntries((await tenantQuery('SELECT key,value FROM settings WHERE store_id=$1',[actor.storeId])).rows.map(s=>[s.key,s.value]));
  const rate=Number(settings.points_rate??1);ensure(Number.isFinite(rate)&&rate>=0&&rate<=1000,409,'INVALID_POINTS_CONFIG','积分规则配置无效');
  const today=localTime().slice(0,10),birth=(member.birthday??'').slice(-5);let multiplier=birth===today.slice(5)?2:1;if(Number(settings.member_day)===Number(today.slice(8)))multiplier*=2;
  const points=new Decimal(order.payable).mul(rate).mul(multiplier).floor().toNumber();ensure(points<=1000000000,400,'POINTS_LIMIT','本单积分超出范围');
  if(points>0){const credited=await credit(member.id,{points},'消费赠积分','points',order.id);effects.asset_operations.push(credited.operation.id)}
 }
 await postEntry(shift,{kind:'sale',amount:order.subtotal,orderId:order.id,reason:'订单结账折前金额'});
 if(order.discount>0)await postEntry(shift,{kind:'discount',amount:order.discount,orderId:order.id,reason:'订单结账优惠'});
 await tenantQuery("UPDATE orders SET status='closed',paid=payable,closed_at=now(),cashier_id=$1,checkout_effects=$2,version=version+1 WHERE id=$3",[actor.user.id,JSON.stringify(effects),order.id]);
 if(member)await updateMemberLevel(member.id);
 if(order.reservation_id){await tenantQuery("UPDATE reservations SET status='completed',version=version+1 WHERE id=$1",[order.reservation_id]);await event('reservation.changed',order.reservation_id)}
 await tenantQuery("UPDATE order_items SET status='done',clock_out_at=coalesce(clock_out_at,now()) WHERE order_id=$1 AND status='active'",[order.id]);
 await releaseTechnicians(order.id);if(order.room_id)await tenantQuery("UPDATE rooms SET status='cleaning' WHERE id=$1",[order.room_id]);
 if(order.wristband_no)await tenantQuery("UPDATE wristbands SET status='idle' WHERE store_id=$1 AND code=$2",[actor.storeId,order.wristband_no]);
 await audit('order.checkout',{paid:order.payable,effects},'order',order.id);await event('session-checkout',order.id);
 // The returned detail and replay receipt are built inside the same committed transaction.
 return session(order.id);
})));
cashierRouter.post('/sessions/:id/reverse-checkout',merchantRoute({...cashAccess,roles:['manager'],action:'reverseSettle'},async(req,actor)=>idempotent(req,'sessions.reverse:'+req.params.id+approvalPhase(req),async()=>{
 const body=z.object({version:Id,reason:z.string().trim().min(1).max(500),approval_id:Id.optional()}).strict().parse(input(req));const shift=await postingShift();const order=await lockOrder(Id.parse(req.params.id),body.version,'closed');
 const effects=JSON.parse(order.checkout_effects??'null');ensure(effects?.version===2,409,'MISSING_CHECKOUT_EFFECTS','缺少可核对的原结账分配');
 const {approval_id,...operation}=body;const pending=await approvalGate(req,{action:'refund',amount:order.payable,targetType:'order',targetId:order.id,before:{version:order.version,paid:order.paid,effects},operation,reason:body.reason,approvalId:approval_id});if(pending)return pending;
 if(order.room_id){await storeObject('rooms',order.room_id,actor.storeId!,true);ensure(!(await tenantQuery("SELECT 1 FROM orders WHERE room_id=$1 AND status IN('open','suspended') AND id<>$2",[order.room_id,order.id])).rowCount,409,'ROOM_BUSY','原房间已有其他账单')}
 if(order.wristband_no){const band=(await tenantQuery('SELECT * FROM wristbands WHERE store_id=$1 AND code=$2 FOR UPDATE',[actor.storeId,order.wristband_no])).rows[0];ensure(band?.status==='idle'&&(!band.room_id||band.room_id===order.room_id),409,'WRISTBAND_BUSY','原手牌使用中或绑定已变化')}
 for(const operationId of [...effects.asset_operations].reverse())await reverseAssets(effects.member_id,operationId,body.reason);
 for(const movementId of effects.material_movements)await reverseStock(movementId,'反结账恢复耗材');
 await reverseOrderEntries(shift,order.id,effects.payment_ids,body.reason);
 await tenantQuery("UPDATE payments SET reversed_at=now() WHERE order_id=$1 AND source='checkout' AND reversed_at IS NULL",[order.id]);
 await tenantQuery("UPDATE orders SET status='open',paid=booking_deposit,closed_at=NULL,checkout_effects=NULL,version=version+1 WHERE id=$1",[order.id]);
 if(effects.member_id)await updateMemberLevel(effects.member_id);
 if(order.reservation_id){await tenantQuery("UPDATE reservations SET status='arrived',version=version+1 WHERE id=$1",[order.reservation_id]);await event('reservation.changed',order.reservation_id)}
 if(order.room_id)await tenantQuery("UPDATE rooms SET status='occupied' WHERE id=$1",[order.room_id]);if(order.wristband_no)await tenantQuery("UPDATE wristbands SET status='used' WHERE store_id=$1 AND code=$2",[actor.storeId,order.wristband_no]);
 await audit('order.reverse_checkout',{reason:body.reason,effects},'order',order.id);await event('session',order.id);return session(order.id);
})));
cashierRouter.get('/orders',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const query=z.object({status:z.enum(['open','closed','suspended','cancelled']).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),limit:z.coerce.number().int().min(1).max(500).default(200),before:Id.optional()}).parse(req.query);
 return (await tenantQuery(`SELECT o.*,r.room_no,r.room_name,m.name AS member_name FROM orders o LEFT JOIN rooms r ON r.merchant_id=o.merchant_id AND r.id=o.room_id LEFT JOIN members m ON m.merchant_id=o.merchant_id AND m.id=o.member_id
 WHERE o.store_id=$1 AND ($2::text IS NULL OR o.status=$2) AND ($3::date IS NULL OR o.opened_at::date=$3) AND ($4::bigint IS NULL OR o.id<$4) ORDER BY o.id DESC LIMIT $5`,[actor.storeId,query.status??null,query.date??null,query.before??null,query.limit])).rows;
}));
cashierRouter.get('/orders/:id',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async req=>orderDetail(Id.parse(req.params.id))));
cashierRouter.get('/snapshot',merchantRoute({store:true,roles:['manager','floor','technician'],support:'read'},async(_req,actor)=>{
 const rooms=(await tenantQuery('SELECT * FROM rooms WHERE store_id=$1 AND active=1 ORDER BY sort_order,id',[actor.storeId])).rows;
 const orders=(await tenantQuery("SELECT * FROM orders WHERE store_id=$1 AND status='open'",[actor.storeId])).rows;
 const items=(await tenantQuery(`SELECT oi.*,t.name AS technician_name,t.code AS technician_code FROM order_items oi JOIN orders o ON o.merchant_id=oi.merchant_id AND o.id=oi.order_id
 LEFT JOIN technicians t ON t.merchant_id=oi.merchant_id AND t.id=oi.technician_id WHERE o.store_id=$1 AND o.status='open'`,[actor.storeId])).rows;
 const mapping:Record<string,string>={occupied:'OCCUPIED',cleaning:'CLEANING',reserved:'RESERVED',maintenance:'MAINTENANCE',idle:'AVAILABLE'};
 let resources=rooms.map(room=>{const order=orders.find(o=>o.room_id===room.id);return {id:room.id,code:room.room_no,name:room.room_name??room.room_no,capacity:room.capacity,room_type:room.room_type,sort_order:room.sort_order,status:mapping[room.status],session_id:order?.id??null,session_version:order?.version??0,guest_name:order?.customer_name??null,opened_at:order?.opened_at??null,total:order?.subtotal??0,items:items.filter(i=>i.order_id===order?.id).map(sessionItem)}});
 const techs=(await tenantQuery(`SELECT t.*,(SELECT count(*) FROM order_items oi WHERE oi.technician_id=t.id AND oi.clock_in_at>=date_trunc('day',now()) AND oi.is_refund=0) AS served_today FROM technicians t WHERE t.store_id=$1 AND t.active=1 ORDER BY t.queue_position,t.id`,[actor.storeId])).rows;
 const techStatus:Record<string,string>={serving:'BUSY',off:'OFF_DUTY',rest:'BREAK',on:'ON_DUTY'};
 let technicians=techs.map(t=>({id:t.id,display_name:t.name,technician_no:t.code,level:t.level,clock_status:techStatus[t.status],sort_order:t.id,queue_position:t.queue_position,served_today:t.served_today,resource_code:resources.find(r=>r.items.some((i:any)=>i.technician_id===t.id&&i.type==='SERVICE'&&!i.is_refund&&i.status==='IN_PROGRESS'))?.code??null,...(['owner','manager','support'].includes(actor.role)?{base_salary:t.base_salary,commission_rate:t.commission_rate,wheel_rate:t.wheel_rate,dianzhong_rate:t.dianzhong_rate,half_rate:t.half_rate,add_time_rate:t.add_time_rate,dianzhong_bonus:t.dianzhong_bonus,phone:t.phone}:{})}));
 const catalog=(await tenantQuery('SELECT id,name,type,price,duration FROM items WHERE store_id=$1 AND active=1 ORDER BY id',[actor.storeId])).rows;
 // A room/clock refresh does not need a directory of member identities and balances.
 const members:any[]=[];
 if(actor.role==='technician'){ensure(actor.technicianId,409,'TECHNICIAN_REQUIRED','账号未关联技师档案');resources=resources.filter(r=>r.items.some((i:any)=>i.technician_id===actor.technicianId)).map(r=>{const own=r.items.filter((i:any)=>i.technician_id===actor.technicianId);return {...r,guest_name:null,total:money(sum(own.filter((i:any)=>!i.is_gift&&!i.is_refund).map((i:any)=>i.total))),items:own}});technicians=technicians.filter(t=>t.id===actor.technicianId)}
 else if(!['owner','support'].includes(actor.role)&&!actor.pages.some(p=>['board','orders'].includes(p))){
  resources=resources.map(r=>({...r,guest_name:null,total:0,items:actor.pages.some(p=>['technicians','clockroom'].includes(p))?r.items.filter((i:any)=>i.type==='SERVICE'):[]}));
 }
 if(!['owner','support'].includes(actor.role)&&!actor.pages.some(p=>['technicians','reports'].includes(p)))technicians=technicians.map(({base_salary,commission_rate,wheel_rate,dianzhong_rate,half_rate,add_time_rate,dianzhong_bonus,phone,...row}:any)=>row);
 return {resources,technicians,services:catalog.filter(i=>i.type==='service').map(i=>({...i,duration_minutes:i.duration})),products:catalog.filter(i=>i.type==='product'),members};
}));
