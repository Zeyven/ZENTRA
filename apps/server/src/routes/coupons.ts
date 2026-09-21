import {Router} from 'express';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,PositiveMoney,input,idempotent,storeObject,money} from '../business.js';
import {ensure} from '../errors.js';
import {lockMember} from '../services/wallet.js';
import {lockOrder,session} from '../services/orders.js';
export const couponsRouter=Router();
const read={store:true,roles:['manager','floor'],support:'read' as const};
couponsRouter.post('/members/wake',merchantRoute({write:true,store:true,roles:['manager'],action:'discount'},async(req,actor)=>idempotent(req,'members.wake',async()=>{
 const b=z.object({name:z.string().trim().min(1).max(100).default('老友回归唤醒券'),value:PositiveMoney.refine(v=>v>0),min_amount:PositiveMoney.default(0),expire_days:z.number().int().min(1).max(365).default(30),threshold_days:z.number().int().min(7).max(3650).default(90)}).strict().parse(input(req));
 // Serialize batches in this store; distinct request keys must also deduplicate.
 await tenantQuery('SELECT id FROM stores WHERE id=$1 FOR UPDATE',[actor.storeId]);
 const candidates=(await tenantQuery(`SELECT m.id FROM members m WHERE m.status='active' AND (m.scope_store_id=$1 OR m.scope_store_id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.member_id=m.id AND o.status='closed' AND o.closed_at>=now()-make_interval(days=>$2))
 AND NOT EXISTS(SELECT 1 FROM coupons c WHERE c.member_id=m.id AND c.store_id=$1 AND c.name=$3 AND c.status='unused' AND (c.expire_at IS NULL OR c.expire_at>=now()))
 ORDER BY m.id LIMIT 1001 FOR UPDATE OF m`,[actor.storeId,b.threshold_days,b.name])).rows;
 ensure(candidates.length<=1000,409,'WAKE_BATCH_LIMIT','符合条件超过 1000 人，请使用营销自动化分批处理');
 const result=await tenantQuery(`INSERT INTO coupons(store_id,member_id,name,type,value,min_amount,expire_at)
 SELECT $1,id,$3,'cash',$4,$5,now()+make_interval(days=>$6) FROM unnest($2::bigint[]) AS selected(id)
 WHERE NOT EXISTS(SELECT 1 FROM coupons c WHERE c.member_id=selected.id AND c.store_id=$1 AND c.name=$3 AND c.status='unused' AND (c.expire_at IS NULL OR c.expire_at>=now())) RETURNING id`,[actor.storeId,candidates.map(m=>m.id),b.name,b.value,b.min_amount,b.expire_days]);
 const count=result.rowCount??0;await audit('members.wake',{...b,count});if(count)await event('coupon.changed');return {count};
})));
export const CouponShape=z.object({member_id:Id.nullable().optional(),name:z.string().trim().min(1).max(100),type:z.enum(['cash','discount']).default('cash'),value:PositiveMoney.refine(v=>v>0),min_amount:PositiveMoney.default(0),expire_at:z.string().refine(s=>/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s)&&!Number.isNaN(Date.parse(s)),'到期时间格式错误').nullable().optional()}).strict().refine(b=>b.type!=='discount'||b.value<=1,'折扣必须在 0 到 1 之间');
couponsRouter.get('/coupons',merchantRoute(read,async(req,actor)=>{
 const id=req.query.member_id?Id.parse(req.query.member_id):null,status=req.query.status?z.enum(['all','unused','used','expired']).parse(req.query.status):'all';if(id)await lockMember(id,false);
 return (await tenantQuery(`SELECT c.*,CASE WHEN c.status='unused' AND c.expire_at<now() THEN 'expired' ELSE c.status END AS status FROM coupons c WHERE c.store_id=$1 AND ($2::bigint IS NULL OR c.member_id=$2) AND ($3='all' OR (CASE WHEN c.status='unused' AND c.expire_at<now() THEN 'expired' ELSE c.status END)=$3) ORDER BY c.id DESC LIMIT 500`,[actor.storeId,id,status])).rows;
}));
couponsRouter.post('/coupons',merchantRoute({write:true,store:true,roles:['manager'],action:'discount'},async(req,actor)=>idempotent(req,'coupons.issue',async()=>{
 const b=CouponShape.parse(input(req));if(b.member_id)await lockMember(b.member_id);
 const expires=b.expire_at?.length===10?b.expire_at+'T23:59:59.999+08:00':b.expire_at??null;ensure(!expires||Date.parse(expires)>Date.now(),400,'COUPON_EXPIRED','到期时间必须晚于当前时间');
 const row=(await tenantQuery('INSERT INTO coupons(store_id,member_id,name,type,value,min_amount,expire_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[actor.storeId,b.member_id??null,b.name,b.type,b.value,b.min_amount,expires])).rows[0];
 await audit('coupon.issued',b,'coupon',row.id);await event('coupon.changed',row.id);return row;
})));
couponsRouter.post('/coupons/:id/use',merchantRoute({write:true,store:true,roles:['manager','floor']},async(req,actor)=>idempotent(req,'coupons.use:'+req.params.id,async()=>{
 const body=z.object({order_id:Id,version:Id}).strict().parse(input(req)),id=Id.parse(req.params.id),order=await lockOrder(body.order_id,body.version),coupon=await storeObject('coupons',id,actor.storeId!,true);
 ensure(coupon.status==='unused',409,'COUPON_USED','优惠券已被使用');ensure(!coupon.expire_at||new Date(coupon.expire_at).getTime()>=Date.now(),409,'COUPON_EXPIRED','优惠券已过期');
 ensure(!coupon.member_id||coupon.member_id===order.member_id,403,'COUPON_MEMBER_MISMATCH','优惠券属于其他会员，请核对本单关联会员');ensure(order.subtotal>=coupon.min_amount,409,'COUPON_THRESHOLD',`消费满 ${coupon.min_amount} 元可用`);
 const available=new Decimal(order.subtotal).minus(order.discount),discount=money(Decimal.min(available,coupon.type==='discount'?new Decimal(order.subtotal).mul(new Decimal(1).minus(coupon.value)):coupon.value));ensure(discount>0,409,'NO_DISCOUNT_REMAINING','本单没有可继续抵扣的金额');
 const detail=order.discount_detail?JSON.parse(order.discount_detail):{manual:order.discount,coupons:[]};detail.coupons.push({id:coupon.id,name:coupon.name,amount:discount});
 await tenantQuery('UPDATE orders SET discount=discount+$1,payable=payable-$1,discount_detail=$2,version=version+1 WHERE id=$3',[discount,JSON.stringify(detail),order.id]);
 await tenantQuery("UPDATE coupons SET status='used',used_order_id=$1,used_discount_amount=$2,used_at=now() WHERE id=$3",[order.id,discount,id]);
 await audit('coupon.used',{order_id:order.id,amount:discount},'coupon',id);await event('coupon.changed',id);return {...await session(order.id),applied_discount:discount};
})));
couponsRouter.post('/coupons/:id/cancel-use',merchantRoute({write:true,store:true,roles:['manager','floor']},async(req,actor)=>idempotent(req,'coupons.cancel-use:'+req.params.id,async()=>{
 const b=z.object({order_id:Id,version:Id,reason:z.string().trim().min(1).max(500)}).strict().parse(input(req)),order=await lockOrder(b.order_id,b.version),coupon=await storeObject('coupons',Id.parse(req.params.id),actor.storeId!,true);
 ensure(coupon.status==='used'&&coupon.used_order_id===order.id,409,'COUPON_ORDER_MISMATCH','优惠券未用于本单');
 const detail=JSON.parse(order.discount_detail??'null');ensure(detail?.coupons?.some((c:any)=>c.id===coupon.id),409,'COUPON_RECORD_MISMATCH','订单用券记录不一致');detail.coupons=detail.coupons.filter((c:any)=>c.id!==coupon.id);
 const discount=money(new Decimal(order.discount).minus(coupon.used_discount_amount));ensure(discount>=0,409,'COUPON_RECORD_MISMATCH','优惠分配不一致');
 await tenantQuery('UPDATE orders SET discount=$1,payable=subtotal-$1,discount_detail=$2,version=version+1 WHERE id=$3',[discount,detail.coupons.length?JSON.stringify(detail):null,order.id]);
 await tenantQuery("UPDATE coupons SET status='unused',used_order_id=NULL,used_discount_amount=0,used_at=NULL WHERE id=$1",[coupon.id]);await audit('coupon.restored',b,'coupon',coupon.id);await event('coupon.changed',coupon.id);return session(order.id);
})));
