import type {Request} from 'express';
import {context,tenantQuery} from '../db/pools.js';
import {audit,event} from '../access.js';
import {canonical,storeObject} from '../business.js';
import {digest} from '../security.js';
import {ensure} from '../errors.js';
interface ApprovalOperation{action:'refund'|'discount'|'inventory_adjustment';amount:number;targetType:string;targetId?:number;reason:string;before:unknown;operation:unknown;approvalId?:number}
export function approvalPhase(req:Request){return req.body?.approval_id?':execute:'+String(req.body.approval_id):':request'}
export async function approvalGate(req:Request,input:ApprovalOperation){
 const c=context();ensure(c.userId&&c.role!=='support',403,'APPROVAL_FORBIDDEN','此会话不能申请经营审批');
 const settings=(await tenantQuery("SELECT value FROM settings WHERE store_id=$1 AND key='approval_thresholds'",[c.storeId])).rows[0];
 const threshold=JSON.parse(settings?.value??'{}')[input.action]??0;
 const operationHash=digest(canonical({action:input.action,target:input.targetType,id:input.targetId??null,amount:input.amount,before:input.before,operation:input.operation}));
 if(input.approvalId){
  const approval=await storeObject('approval_requests',input.approvalId,c.storeId!,true);
  ensure(approval.status==='approved'&&(c.platformAdmin||approval.requested_by===c.userId&&approval.reviewed_by!==c.userId)&&approval.operation_hash===operationHash&&new Date(approval.reviewed_at).getTime()>Date.now()-86400000,409,'APPROVAL_INVALID','审批尚未通过、已使用、已过期或操作内容已变化，请重新申请');
  await tenantQuery("UPDATE approval_requests SET status='consumed',consumed_at=now() WHERE id=$1",[approval.id]);await audit('approval.consumed',{operation_hash:operationHash},'approval',approval.id);await event('approval.changed',approval.id);return null;
 }
 if(threshold<=0||input.amount<threshold)return null;
 if(c.platformAdmin){await audit('approval.platform_override',{action:input.action,amount:input.amount,reason:input.reason,operation_hash:operationHash},input.targetType,input.targetId);return null;}
 ensure(input.reason.trim(),400,'REASON_REQUIRED','超过审批阈值，请填写申请原因');
 const {approval_id,request_key,store_id,...body}=req.body;
 const saved=(await tenantQuery(`INSERT INTO approval_requests(store_id,action_type,target_type,target_id,reason,before_snapshot,after_snapshot,requested_by,operation_hash)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(merchant_id,store_id,requested_by,operation_hash) WHERE status IN('pending','approved') DO UPDATE SET operation_hash=excluded.operation_hash RETURNING id,status`,[c.storeId,input.action,input.targetType,input.targetId??null,input.reason,canonical(input.before),JSON.stringify({requested_amount:input.amount,operation:input.operation,execute:{path:req.path,method:req.method,body}}),c.userId,operationHash])).rows[0];
 await audit('approval.requested',{action:input.action,amount:input.amount},'approval',saved.id);await event('approval.changed',saved.id);
 return {pending_approval:true,approval_id:saved.id,message:saved.status==='approved'?'审批已通过，请在审批中心执行原操作':'已提交审批，业务数据尚未改变'};
}
