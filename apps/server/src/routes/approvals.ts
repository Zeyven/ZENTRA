import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,input,idempotent,storeObject} from '../business.js';
import {ensure} from '../errors.js';
export const approvalsRouter=Router();
approvalsRouter.get('/approvals',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const status=z.enum(['pending','approved','rejected','consumed','cancelled','all']).default('pending').parse(req.query.status);
 return (await tenantQuery(`SELECT a.*,u.name AS requester_name,r.name AS reviewer_name FROM approval_requests a LEFT JOIN merchant_users u ON u.merchant_id=a.merchant_id AND u.id=a.requested_by LEFT JOIN merchant_users r ON r.merchant_id=a.merchant_id AND r.id=a.reviewed_by WHERE a.store_id=$1 AND ($2='all' OR a.status=$2) AND ($3::bigint IS NULL OR a.requested_by=$3) ORDER BY a.id DESC LIMIT 300`,[actor.storeId,status,actor.role==='floor'?actor.user.id:null])).rows;
}));
approvalsRouter.post('/approvals/:id/review',merchantRoute({store:true,write:true,roles:['manager'],action:'approve'},async(req,actor)=>idempotent(req,'approval.review:'+req.params.id,async()=>{
 const b=z.object({status:z.enum(['approved','rejected']),review_note:z.string().max(1000).default('')}).strict().parse(input(req));const row=await storeObject('approval_requests',Id.parse(req.params.id),actor.storeId!,true);
 ensure(row.status==='pending',409,'APPROVAL_REVIEWED','审批已处理');ensure(actor.supportScope==='platform_admin'||row.requested_by!==actor.user.id,403,'SELF_APPROVAL','不能审核自己的申请');
 const result=(await tenantQuery('UPDATE approval_requests SET status=$1,reviewed_by=$2,review_note=$3,reviewed_at=now() WHERE id=$4 RETURNING *',[b.status,actor.user.id,b.review_note,row.id])).rows[0];await audit('approval.'+b.status,b,'approval',row.id);await event('approval.changed',row.id);return result;
})));
approvalsRouter.post('/approvals/:id/cancel',merchantRoute({store:true,write:true,roles:['manager','floor']},async(req,actor)=>idempotent(req,'approval.cancel:'+req.params.id,async()=>{
 z.object({}).strict().parse(input(req));const row=await storeObject('approval_requests',Id.parse(req.params.id),actor.storeId!,true);ensure(actor.supportScope==='platform_admin'||row.requested_by===actor.user.id,403,'APPROVAL_REQUESTER_ONLY','只能撤销自己的申请');ensure(['pending','approved'].includes(row.status),409,'APPROVAL_FINISHED','审批已经结束');await tenantQuery("UPDATE approval_requests SET status='cancelled' WHERE id=$1",[row.id]);await audit('approval.cancelled',{},'approval',row.id);await event('approval.changed',row.id);return {id:row.id,cancelled:true};
})));
