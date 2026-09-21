import {updateMemberLevel} from '../services/member-levels.js';
import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {merchantRoute,audit,event,authorize} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,PositiveMoney,Count,input,idempotent,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {credit,lockMember,reverseAssets,adjustAssets} from '../services/wallet.js';
import {postingShift,postEntry} from '../services/shifts.js';
import {approvalGate,approvalPhase} from '../services/approvals.js';
import {MemberAdjustment,defaultActions,defaultPages} from '@za-spa/contracts';
import type {Actor} from '../access.js';
import {DateOnly} from '../services/dates.js';
export const membersRouter=Router();
const name=z.string().trim().min(1).max(100),text=z.string().max(200).nullable().optional();
const optionalDate=z.union([DateOnly,z.literal(''),z.null()]).optional();
async function rechargeOrigin(actor:Actor,memberId:number,operationId:number){
 const operation=(await tenantQuery('SELECT * FROM asset_operations WHERE id=$1 AND member_id=$2',[operationId,memberId])).rows[0];
 ensure(operation?.type==='recharge',404,'NOT_FOUND','原充值流水不存在');
 if(actor.role==='owner')return operation;
 const store=actor.stores.find(s=>s.id===operation.store_id&&s.status===1&&s.role==='manager');
 ensure(store,403,'ORIGIN_STORE_FORBIDDEN','需要原充值门店的管理授权');
 const rows=(await tenantQuery("SELECT kind,perm_key,enabled FROM role_permissions WHERE store_id=$1 AND role=$2",[store.id,store.role])).rows;
 const permission=rows.find(p=>p.kind==='action'&&p.perm_key==='reverseSettle');
 ensure((!store.pages||store.pages.includes('members'))&&(!store.actions||store.actions.includes('reverseSettle'))&&defaultPages[store.role]?.includes('members')&&rows.find(p=>p.kind==='page'&&p.perm_key==='members')?.enabled!==0&&(permission?permission.enabled===1:(store.actions??defaultActions[store.role])?.includes('reverseSettle')),403,'ORIGIN_STORE_FORBIDDEN','需要原充值门店的会员管理和充值冲销权限');
 return operation;
}
membersRouter.get('/members/search',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const keyword=z.string().trim().min(1).max(100).parse(req.query.keyword);
 return (await tenantQuery(`SELECT id,name,phone,card_no,card_type,balance,bonus_balance,times_balance,points,discount,status FROM members
 WHERE (scope_store_id=$1 OR scope_store_id IS NULL) AND status='active' AND (name ILIKE $2 OR phone ILIKE $2 OR card_no ILIKE $2) ORDER BY id DESC LIMIT 20`,[actor.storeId,'%'+keyword.replace(/[\\%_]/g,'\\$&')+'%'])).rows;
}));
membersRouter.get('/members',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const keyword=z.string().max(100).default('').parse(req.query.keyword),limit=z.coerce.number().int().min(1).max(500).default(200).parse(req.query.limit);
 return (await tenantQuery(`SELECT m.* FROM members m JOIN merchants t ON t.id=m.merchant_id WHERE (m.store_id=$1 OR t.member_mode='merchant') AND m.status!='archived'
 AND (m.name ILIKE $2 OR m.phone ILIKE $2 OR m.card_no ILIKE $2) ORDER BY m.id DESC LIMIT $3`,[actor.storeId,'%'+keyword+'%',limit])).rows;
}));
membersRouter.post('/members',merchantRoute({write:true,store:true,roles:['manager','floor']},async(req,actor)=>idempotent(req,'members.save',async()=>{
 const body=z.object({id:Id.optional(),name,phone:text,card_no:z.string().trim().min(1).max(100).optional(),card_type:z.enum(['storage','times','discount']).optional(),discount:z.number().gt(0).lte(1).optional(),salesman:text,tags:text,level:name.optional(),birthday:optionalDate,expiry:optionalDate,balance:PositiveMoney.optional(),bonus_balance:PositiveMoney.optional(),times_balance:Count.optional(),points:Count.optional(),reason:z.string().trim().max(500).optional()}).strict().parse(input(req));
 const before=body.id?await lockMember(body.id,false):null;
 // Saving contact details must not turn an automatically earned level into a permanent override.
 if(before&&body.level===before.level)body.level=undefined;
 const cardType=body.card_type??before?.card_type??'storage',discount=body.discount??before?.discount??1,cardNo=body.card_no??before?.card_no??'C'+randomUUID().replaceAll('-','').slice(0,16);
 if(discount!==(before?.discount??1)||(body.level!==undefined&&body.level!==(before?.base_level??'普通会员'))){
  ensure(actor.role==='owner'||actor.role==='manager',403,'ACTION_FORBIDDEN','会员折扣与等级调整需要店长或老板权限');
  ensure(actor.role==='owner'||actor.actions.includes('discount'),403,'ACTION_FORBIDDEN','未授权会员折扣与等级调整');
 }
 if(before&&before.card_type!==cardType)ensure(before.balance===0&&before.bonus_balance===0&&before.times_balance===0,409,'CARD_TYPE_HAS_ASSETS','会员仍有权益，不能直接变更卡类型');
 const balances={principal:body.balance??before?.balance??0,bonus:body.bonus_balance??before?.bonus_balance??0,times:body.times_balance??before?.times_balance??0,points:body.points??before?.points??0};
 if(before)ensure(balances.principal===before.balance&&balances.bonus===before.bonus_balance&&balances.times===before.times_balance&&balances.points===before.points,409,'USE_ASSET_OPERATION','资产变更请使用充值、调整或冲销操作');
 const initial=Object.values(balances).some(v=>v!==0)&&!before;
 if(initial||(before&&discount!==before.discount)||(!before&&discount!==1)||(before&&cardNo!==before.card_no))ensure(actor.role==='owner'||actor.role==='manager',403,'ACTION_FORBIDDEN','没有调整会员权益或卡号的权限');
 if(initial){ensure(body.reason,400,'REASON_REQUIRED','请填写期初权益原因');await authorize(actor.claims,actor.storeId,{write:true,store:true,action:'adjust'})}
 const profile=(key:'phone'|'salesman'|'tags')=>body[key]===undefined?before?.[key]??null:body[key];
 const values=[body.name,profile('phone'),cardType,discount,profile('salesman'),profile('tags'),body.level??before?.level??'普通会员',body.birthday===undefined?before?.birthday??null:body.birthday||null,body.expiry===undefined?before?.expiry??null:body.expiry||null];
 let member:any;
 if(before)member=(await tenantQuery('UPDATE members SET name=$1,phone=$2,card_type=$3,discount=$4,salesman=$5,tags=$6,level=$7,birthday=$8,expiry=$9,card_no=$10 WHERE id=$11 RETURNING *',[...values,cardNo,before.id])).rows[0];
 else member=(await tenantQuery('INSERT INTO members(name,phone,card_type,discount,salesman,tags,level,birthday,expiry,store_id,card_no) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[...values,actor.storeId,cardNo])).rows[0];
 if(initial)member=(await credit(member.id,balances,body.reason!,'adjust')).member;
 if(!before||(body.level!==undefined&&body.level!==before.level))await tenantQuery('UPDATE members SET base_level=$1 WHERE id=$2',[body.level??'普通会员',member.id]);
 member=await updateMemberLevel(member.id);
 await audit('member.saved',{before,after:member},'member',member.id);await event('member.changed',member.id,member.scope_store_id??null);return member;
})));
membersRouter.post('/members/recharge',merchantRoute({write:true,store:true,roles:['manager','floor'],action:'recharge'},async(req,actor)=>idempotent(req,'members.recharge',async()=>{
 const body=z.object({customer_id:Id,amount:PositiveMoney.refine(v=>v>0),gift_amount:PositiveMoney.default(0),times:Count.default(0),points:Count.default(0),plan_id:Id.optional(),method:z.enum(['现金','微信','支付宝','银行卡']).default('现金')}).strict().parse(input(req));
 let gift=body.gift_amount;
 if(body.plan_id){const plan=await storeObject('recharge_plans',body.plan_id,actor.storeId!);ensure(plan.active===1&&plan.amount===body.amount,400,'PLAN_MISMATCH','充值方案与充值金额不一致');gift=plan.gift_amount}
 if((gift>0&&!body.plan_id)||body.times>0||body.points>0)ensure(['owner','manager'].includes(actor.role),403,'ACTION_FORBIDDEN','自定义赠送权益需要管理权限');
 const shift=await postingShift(),account=await lockMember(body.customer_id);
 if(account.card_type==='times')ensure(body.times>0&&gift===0,400,'TIMES_PURCHASE_REQUIRED','次卡充值请填写购买次数，不能同时发放储值赠金');
 else ensure(body.times===0,400,'STORAGE_PURCHASE_REQUIRED','储值会员请使用金额充值，次数由次卡管理');
 const result=await credit(body.customer_id,{principal:account.card_type==='times'?0:body.amount,bonus:gift,times:body.times,points:body.points},'会员充值','recharge',undefined,{method:body.method,shiftId:shift?.id,amount:body.amount});
 await postEntry(shift,{kind:'recharge',method:body.method,amount:body.amount,operationId:result.operation.id,reason:'会员充值'});
 return {...result,...result.member};
})));
membersRouter.post('/members/:id/reverse-recharge',merchantRoute({write:true,store:true,roles:['manager'],action:'reverseSettle'},async(req,actor)=>{await rechargeOrigin(actor,Id.parse(req.params.id),Id.parse(req.body?.recharge_id));return idempotent(req,'members.reverse-recharge:'+req.params.id+approvalPhase(req),async()=>{
 const body=z.object({recharge_id:Id,reason:z.string().trim().min(1).max(500),approval_id:Id.optional()}).strict().parse(input(req));const id=Id.parse(req.params.id);
 const shift=await postingShift();const operation=(await tenantQuery('SELECT * FROM asset_operations WHERE id=$1 AND member_id=$2',[body.recharge_id,id])).rows[0];ensure(operation?.type==='recharge',404,'NOT_FOUND','原充值流水不存在');
 ensure(actor.user.role==='owner'||actor.stores.some(s=>s.id===operation.store_id&&s.role==='manager'),403,'ORIGIN_STORE_FORBIDDEN','需要原充值门店的管理授权');
 ensure(operation.payment_method&&operation.funded_amount>0,409,'MISSING_FUNDING_METHOD','原充值缺少收款依据，不能确认资金退款');
 const account=await lockMember(id,false);const {approval_id,...requested}=body;const pending=await approvalGate(req,{action:'refund',amount:operation.funded_amount,targetType:'member',targetId:id,before:{recharge_id:operation.id,asset_version:account.asset_version,balance:account.balance,bonus:account.bonus_balance,times:account.times_balance,points:account.points},operation:requested,reason:body.reason,approvalId:approval_id});if(pending)return pending;
 const result=await reverseAssets(id,body.recharge_id,body.reason);
 await postEntry(shift,{kind:'recharge_reversal',method:operation.payment_method,amount:-operation.funded_amount,operationId:result.operation.id,reason:body.reason});return {...result,...result.member};
})}));
membersRouter.get('/members/:id',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const id=Id.parse(req.params.id),member=await lockMember(id,false);
 const scope=actor.role==='owner'?null:actor.storeId;
 const profile=(await tenantQuery("SELECT coalesce(sum(payable),0) AS total_consume,count(*) AS consume_count,coalesce(avg(payable),0) AS avg_consume,max(closed_at) AS last_consume_at FROM orders WHERE member_id=$1 AND status='closed' AND ($2::bigint IS NULL OR store_id=$2)",[id,scope])).rows[0];
 const favoriteItems=(await tenantQuery("SELECT oi.item_name AS name,sum(oi.quantity) AS count FROM order_items oi JOIN orders o ON o.merchant_id=oi.merchant_id AND o.id=oi.order_id WHERE o.member_id=$1 AND o.status='closed' AND oi.is_refund=0 AND ($2::bigint IS NULL OR o.store_id=$2) GROUP BY oi.item_name ORDER BY count DESC LIMIT 8",[id,scope])).rows;
 const transactions=(await tenantQuery('SELECT a.*,s.name AS store_name,a.principal AS amount,a.reason AS remark,(SELECT r.id FROM asset_operations r WHERE r.reversal_of=a.id) AS reversed_by FROM asset_operations a JOIN stores s ON s.merchant_id=a.merchant_id AND s.id=a.store_id WHERE a.member_id=$1 AND ($2::bigint IS NULL OR a.store_id=$2) ORDER BY a.id DESC LIMIT 200',[id,scope])).rows;
 return {...member,profile,favoriteItems,transactions,coupons:(await tenantQuery('SELECT * FROM coupons WHERE member_id=$1 AND store_id=$2 ORDER BY id DESC LIMIT 200',[id,actor.storeId])).rows};
}));
membersRouter.get('/members/:id/assets',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const member=await lockMember(Id.parse(req.params.id),false),before=req.query.before?Id.parse(req.query.before):null;
 const rows=(await tenantQuery(`SELECT a.*,s.name AS store_name,(SELECT r.id FROM asset_operations r WHERE r.reversal_of=a.id) AS reversed_by
 FROM asset_operations a JOIN stores s ON s.merchant_id=a.merchant_id AND s.id=a.store_id
 WHERE a.member_id=$1 AND ($2::bigint IS NULL OR a.store_id=$2) AND ($3::bigint IS NULL OR a.id<$3) ORDER BY a.id DESC LIMIT 51`,[member.id,actor.role==='owner'?null:actor.storeId,before])).rows;
 return {member,items:rows.slice(0,50),next_cursor:rows.length>50?rows[49].id:null};
}));
membersRouter.get('/members/:id/assets/:operationId',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const member=await lockMember(Id.parse(req.params.id),false),operation=(await tenantQuery('SELECT * FROM asset_operations WHERE id=$1 AND member_id=$2 AND ($3::bigint IS NULL OR store_id=$3)',[Id.parse(req.params.operationId),member.id,actor.role==='owner'?null:actor.storeId])).rows[0];
 ensure(operation,404,'NOT_FOUND','权益流水不存在或未授权');
 const allocations=(await tenantQuery(`SELECT a.lot_id,a.principal,a.bonus,a.times,a.points,l.origin_store_id,s.name AS origin_store_name FROM asset_allocations a JOIN asset_lots l ON l.merchant_id=a.merchant_id AND l.id=a.lot_id JOIN stores s ON s.merchant_id=l.merchant_id AND s.id=l.origin_store_id WHERE a.operation_id=$1 ORDER BY a.lot_id`,[operation.id])).rows;
 return {operation,allocations};
}));
membersRouter.get('/members/:id/points',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const id=Id.parse(req.params.id);await lockMember(id,false);return (await tenantQuery('SELECT id,type,points,reason AS remark,created_at FROM asset_operations WHERE member_id=$1 AND points<>0 AND ($2::bigint IS NULL OR store_id=$2) ORDER BY id DESC LIMIT 200',[id,actor.role==='owner'?null:actor.storeId])).rows;
}));
membersRouter.post('/members/:id/status',merchantRoute({write:true,store:true,roles:['manager']},async req=>{
 const id=Id.parse(req.params.id),body=z.object({status:z.enum(['active','frozen'])}).strict().parse(input(req));await lockMember(id,false);
 const member=(await tenantQuery('UPDATE members SET status=$1 WHERE id=$2 RETURNING *',[body.status,id])).rows[0];await audit('member.status',body,'member',id);await event('member.changed',id,member.scope_store_id??null);return member;
}));
membersRouter.post('/members/:id/adjust',merchantRoute({write:true,store:true,roles:['manager'],action:'adjust'},async req=>idempotent(req,'members.adjust:'+req.params.id,async()=>{
 const body=MemberAdjustment.parse(input(req));const account=await lockMember(Id.parse(req.params.id),false);ensure(account.asset_version===body.version,409,'ASSETS_CHANGED','会员权益已变化，请刷新核对后重新调整');
 const {version,reason,...deltas}=body;return adjustAssets(account.id,deltas,reason);
})));
membersRouter.post('/members/:id/points-exchange',merchantRoute({write:true,store:true,roles:['manager','floor'],action:'recharge'},async req=>idempotent(req,'members.points:'+req.params.id,async()=>{
 const body=z.object({points:Count.refine(v=>v>0),remark:z.string().trim().min(1).max(500)}).strict().parse(input(req)),id=Id.parse(req.params.id);await lockMember(id);
 const result=await adjustAssets(id,{principal:0,bonus:0,times:0,points:-body.points},body.remark,'points');return {...result,points:result.member.points};
})));
membersRouter.delete('/members/:id',merchantRoute({write:true,store:true,roles:['manager']},async req=>{
 const id=Id.parse(req.params.id),member=await lockMember(id,false);ensure(member.balance===0&&member.bonus_balance===0&&member.times_balance===0&&member.points===0,409,'MEMBER_HAS_ASSETS','会员仍有余额、赠金、次数或积分，可先冻结');
 await tenantQuery("UPDATE members SET status='archived' WHERE id=$1",[id]);await audit('member.archived',{},'member',id);await event('member.changed',id,member.scope_store_id??null);return {id,archived:true};
}));
