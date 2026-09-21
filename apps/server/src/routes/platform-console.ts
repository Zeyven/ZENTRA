import {Router} from 'express';
import {z} from 'zod';
import {Password} from '@za-spa/contracts';
import {platformRoute} from '../access.js';
import {platformPool,platformTransaction} from '../db/pools.js';
import {ensure} from '../errors.js';
import {hashPassword,verifyPassword} from '../security.js';
export const platformConsoleRouter=Router();
const paging={page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)};
platformConsoleRouter.get('/overview',platformRoute(async()=>{
 const summary=(await platformPool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE status='active')::int active,count(*) FILTER(WHERE status='suspended')::int suspended,count(*) FILTER(WHERE created_at>now()-interval '30 days')::int new_30_days FROM merchants`)).rows[0];
 const invitations=(await platformPool.query(`SELECT count(*) FILTER(WHERE used_at IS NULL AND expires_at>now())::int pending,count(*) FILTER(WHERE used_at IS NOT NULL)::int activated,count(*) FILTER(WHERE used_at IS NULL AND expires_at<=now())::int expired FROM owner_invites`)).rows[0];
 return {checked_at:new Date().toISOString(),merchants:summary,invitations};
}));
platformConsoleRouter.get('/directory',platformRoute(async req=>{
 const q=z.object({...paging,search:z.string().trim().max(100).default(''),status:z.enum(['all','active','suspended']).default('all'),activation:z.enum(['all','pending','activated','expired']).default('all')}).strict().parse(req.query);
 const where=`WHERE ($1='' OR strpos(lower(m.name),lower($1))>0 OR strpos(lower(m.code),lower($1))>0) AND ($2='all' OR m.status=$2) AND ($3='all' OR i.activation=$3)`;
 const join=`FROM merchants m LEFT JOIN LATERAL (SELECT id AS invite_id,expires_at,used_at,CASE WHEN used_at IS NOT NULL THEN 'activated' WHEN expires_at>now() THEN 'pending' ELSE 'expired' END activation FROM owner_invites WHERE merchant_id=m.id ORDER BY expires_at DESC,id DESC LIMIT 1) i ON true`;
 return platformTransaction(async c=>{
  const total=Number((await c.query(`SELECT count(*) n ${join} ${where}`,[q.search,q.status,q.activation])).rows[0].n);
  const items=(await c.query(`SELECT m.*,i.activation,i.expires_at AS invite_expires_at ${join} ${where} ORDER BY m.created_at DESC,m.id LIMIT $4 OFFSET $5`,[q.search,q.status,q.activation,q.limit,(q.page-1)*q.limit])).rows;
  return {items,total,page:q.page,limit:q.limit};
 });
}));
platformConsoleRouter.patch('/merchants/:id/profile',platformRoute(async(req,user)=>{
 const id=z.uuid().parse(req.params.id),b=z.object({name:z.string().trim().min(1).max(100),previous_name:z.string().min(1).max(100),reason:z.string().trim().min(1).max(500)}).strict().parse(req.body);
 return platformTransaction(async c=>{
  const old=(await c.query('SELECT id,name FROM merchants WHERE id=$1 FOR UPDATE',[id])).rows[0];ensure(old,404,'NOT_FOUND','商家不存在');ensure(old.name===b.previous_name,409,'CONFLICT','商家资料已变更，请刷新后重试');
  const row=(await c.query('UPDATE merchants SET name=$1 WHERE id=$2 RETURNING *',[b.name,id])).rows[0];
  await c.query("INSERT INTO platform_audit(platform_user_id,merchant_id,action,detail) VALUES($1,$2,'merchant.profile.updated',$3)",[user.id,id,JSON.stringify({previous_name:old.name,name:b.name,reason:b.reason})]);return row;
 });
}));
platformConsoleRouter.get('/activity',platformRoute(async req=>{
 const q=z.object({...paging,search:z.string().trim().max(100).default(''),merchant_id:z.uuid().optional(),from:z.iso.datetime().optional(),to:z.iso.datetime().optional()}).strict().parse(req.query);
 ensure(!q.from||!q.to||q.from<=q.to,400,'INVALID_RANGE','结束时间不能早于开始时间');
 const args=[q.search,q.merchant_id??null,q.from??null,q.to??null];
 const from=`FROM platform_audit a LEFT JOIN platform_users u ON u.id=a.platform_user_id LEFT JOIN merchants m ON m.id=a.merchant_id WHERE ($1='' OR strpos(lower(a.action),lower($1))>0 OR strpos(lower(coalesce(u.name,'')),lower($1))>0 OR strpos(lower(coalesce(m.name,'')),lower($1))>0) AND ($2::uuid IS NULL OR a.merchant_id=$2) AND ($3::timestamptz IS NULL OR a.created_at>=$3) AND ($4::timestamptz IS NULL OR a.created_at<$4)`;
 const total=Number((await platformPool.query(`SELECT count(*) n ${from}`,args)).rows[0].n);
 const items=(await platformPool.query(`SELECT a.*,u.name AS operator_name,m.name AS merchant_name,m.code AS merchant_code ${from} ORDER BY a.id DESC LIMIT $5 OFFSET $6`,[...args,q.limit,(q.page-1)*q.limit])).rows;
 return {items,total,page:q.page,limit:q.limit};
}));
platformConsoleRouter.get('/sessions',platformRoute(async(_req,user,claims)=>({items:(await platformPool.query(`SELECT id,created_at,expires_at,id=$2::uuid AS current FROM platform_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 100`,[user.id,claims.sid])).rows})));
platformConsoleRouter.post('/sessions/:id/revoke',platformRoute(async(req,user)=>{
 const id=z.uuid().parse(req.params.id);return platformTransaction(async c=>{
  const row=(await c.query('UPDATE platform_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id',[id,user.id])).rows[0];ensure(row,404,'NOT_FOUND','会话不存在');
  await c.query("INSERT INTO platform_audit(platform_user_id,action,detail) VALUES($1,'platform.session.revoked',$2)",[user.id,JSON.stringify({session_id:id})]);await c.query("SELECT pg_notify('saas_access','{}')");return {revoked:true};
 });
}));
platformConsoleRouter.post('/account/password',platformRoute(async(req,user)=>{
 const b=z.object({current_password:z.string().min(1).max(128),new_password:Password}).strict().parse(req.body);
 const password=await hashPassword(b.new_password);
 return platformTransaction(async c=>{
  const row=(await c.query('SELECT password FROM platform_users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];ensure(await verifyPassword(b.current_password,row.password),400,'PASSWORD_INVALID','当前密码不正确');
  await c.query('UPDATE platform_users SET password=$1,token_version=token_version+1 WHERE id=$2',[password,user.id]);await c.query('UPDATE platform_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[user.id]);
  await c.query("INSERT INTO platform_audit(platform_user_id,action) VALUES($1,'platform.password.changed')",[user.id]);await c.query("SELECT pg_notify('saas_access','{}')");return {reauthenticate:true};
 });
}));
platformConsoleRouter.post('/support-grants/:id/revoke',platformRoute(async(req,user)=>{
 const id=z.uuid().parse(req.params.id);return platformTransaction(async c=>{
  const row=(await c.query('UPDATE support_grants SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND platform_user_id=$2 RETURNING merchant_id',[id,user.id])).rows[0];ensure(row,404,'NOT_FOUND','支持授权不存在');
  await c.query("INSERT INTO platform_audit(platform_user_id,merchant_id,action,detail) VALUES($1,$2,'support.revoked.by.operator',$3)",[user.id,row.merchant_id,JSON.stringify({grant_id:id})]);await c.query("SELECT pg_notify('saas_access',$1)",[JSON.stringify({merchant_id:row.merchant_id})]);return {revoked:true};
 });
}));
platformConsoleRouter.get('/merchants/:id/stores',platformRoute(async req=>{
 const mid=z.uuid().parse(req.params.id);ensure((await platformPool.query('SELECT 1 FROM merchants WHERE id=$1',[mid])).rowCount,404,'NOT_FOUND','商家不存在');
 return {items:(await platformPool.query('SELECT platform_store_directory($1) items',[mid])).rows[0].items};
}));
platformConsoleRouter.post('/merchants/:id/stores/:storeId/manage',platformRoute(async(req,user)=>{
 const mid=z.uuid().parse(req.params.id),sid=z.coerce.number().int().positive().parse(req.params.storeId);
 const b=z.object({operation:z.enum(['disable','restore','delete']),version:z.number().int().nonnegative(),reason:z.string().trim().min(1).max(500),confirmation_code:z.string().max(40).optional(),current_password:z.string().min(1).max(128).optional()}).strict().parse(req.body);
 return platformTransaction(async c=>{
  if(b.operation==='delete'){ensure(b.current_password,400,'PASSWORD_REQUIRED','强制删除须验证当前平台密码');const row=(await c.query('SELECT password FROM platform_users WHERE id=$1',[user.id])).rows[0];ensure(await verifyPassword(b.current_password,row.password),403,'PASSWORD_INVALID','当前平台密码不正确');}
  const result=(await c.query('SELECT platform_manage_store($1,$2,$3,$4,$5,$6,$7) result',[mid,sid,b.operation,b.version,user.id,b.reason,b.confirmation_code??null])).rows[0].result;
  const messages:Record<string,string>={NOT_FOUND:'门店不存在或不属于该商家',STORE_DELETED:'门店已永久删除，不支持恢复',VERSION_CONFLICT:'门店状态已变化，请刷新列表后重试',CONFIRMATION_REQUIRED:'请输入目标门店编号确认强制删除'};
  ensure(!result.error,result.error==='NOT_FOUND'?404:409,result.error,messages[result.error]??'操作失败');return result;
 });
}));
