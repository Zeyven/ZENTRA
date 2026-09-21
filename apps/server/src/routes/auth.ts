import {Router,type Request} from 'express';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {MerchantLogin,MerchantCreate,AccountName,Password} from '@za-spa/contracts';
import {inTenant,platformPool,platformTransaction,tenantQuery} from '../db/pools.js';
import {hashPassword,verifyPassword,digest,randomToken,signToken,type Claims} from '../security.js';
import {ensure,HttpError} from '../errors.js';
import {audit,authorize,bootstrap,event,merchantRoute,platformRoute} from '../access.js';
export const platformRouter=Router(),merchantRouter=Router();
const loginShape=z.object({username:AccountName,password:z.string().min(1).max(128)}).strict();
const dummyPassword=await hashPassword(randomToken());
const reply=(handler:(req:Request)=>Promise<unknown>)=>async(req:any,res:any,next:any)=>{try{res.json({ok:true,data:await handler(req)})}catch(e){next(e)}};
async function rateLimited<T>(key:string,action:(client:PoolClient)=>Promise<T>):Promise<T>{
 // Login failure updates commit even when the response fails. Advisory locks serialize an account only.
 const result=await platformTransaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
  const row=(await c.query('SELECT * FROM auth_attempts WHERE attempt_key=$1',[key])).rows[0];
  if(row?.locked_until&&new Date(row.locked_until).getTime()>Date.now())return {error:new HttpError(429,'LOGIN_RATE_LIMIT','尝试过多，请 15 分钟后重试')};
  try{const value=await action(c);await c.query('DELETE FROM auth_attempts WHERE attempt_key=$1',[key]);return {value}}
  catch(error){if(error instanceof HttpError&&error.status===401)await c.query(`INSERT INTO auth_attempts(attempt_key,failures,updated_at) VALUES($1,1,now())
   ON CONFLICT(attempt_key) DO UPDATE SET failures=CASE WHEN auth_attempts.updated_at<now()-interval '15 minutes' THEN 1 ELSE auth_attempts.failures+1 END,
   locked_until=CASE WHEN auth_attempts.updated_at>=now()-interval '15 minutes' AND auth_attempts.failures>=4 THEN now()+interval '15 minutes' ELSE NULL END,updated_at=now()`,[key]);return {error}}
 });
 if('error' in result)throw result.error;return result.value as T;
}
platformRouter.post('/auth/login',reply(async req=>{
 const body=loginShape.parse(req.body);
 return rateLimited('platform:'+digest(body.username),async c=>{
  const user=(await c.query('SELECT * FROM platform_users WHERE username=$1',[body.username])).rows[0];
  const valid=await verifyPassword(body.password,user?.password??dummyPassword);ensure(user?.active&&valid,401,'LOGIN_FAILED','账号或密码错误');
  const sid=randomUUID();await c.query("INSERT INTO platform_sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[sid,user.id]);
  await c.query("INSERT INTO platform_audit(platform_user_id,action,detail) VALUES($1,'platform.login',$2)",[user.id,JSON.stringify({session_id:sid})]);
  return {realm:'platform',token:signToken({realm:'platform',uid:user.id,sid,version:user.token_version}),user:{id:user.id,name:user.name,username:user.username}};
 });
}));
platformRouter.post('/auth/logout',platformRoute(async(_req,_user,claims)=>{await platformTransaction(async c=>{await c.query('UPDATE platform_sessions SET revoked_at=now() WHERE id=$1',[claims.sid]);await c.query("SELECT pg_notify('saas_access','{}')")});return {logged_out:true}}));
platformRouter.get('/session',platformRoute(async(_req,user)=>({realm:'platform',user})));
platformRouter.get('/merchants',platformRoute(async()=>({items:(await platformPool.query('SELECT * FROM merchants ORDER BY created_at DESC')).rows})));
platformRouter.post('/merchants',platformRoute(async(req,user)=>{
 const body=MerchantCreate.parse(req.body);const token=randomToken();
 return platformTransaction(async c=>{
  const merchant=(await c.query('INSERT INTO merchants(code,name,member_mode) VALUES($1,$2,$3) RETURNING *',[body.code,body.name,body.member_mode])).rows[0];
  const invite=(await c.query("INSERT INTO owner_invites(merchant_id,token_hash,expires_at,created_by) VALUES($1,$2,now()+interval '7 days',$3) RETURNING id,expires_at",[merchant.id,digest(token),user.id])).rows[0];
  await c.query("INSERT INTO platform_audit(platform_user_id,merchant_id,action,detail) VALUES($1,$2,'merchant.created',$3)",[user.id,merchant.id,JSON.stringify(body)]);
  return {merchant,invite:{...invite,token,activation_url:`${process.env.PUBLIC_ORIGIN}/activate?token=${encodeURIComponent(token)}`}};
 });
}));
platformRouter.patch('/merchants/:id/status',platformRoute(async(req,user)=>{
 const id=z.uuid().parse(req.params.id),body=z.object({status:z.enum(['active','suspended']),reason:z.string().trim().min(1).max(500).optional()}).strict().parse(req.body);
 return platformTransaction(async c=>{
  ensure((await c.query("SELECT pg_try_advisory_xact_lock_shared(hashtextextended($1||':restore',0)) AS acquired",[id])).rows[0].acquired,409,'RECOVERY_IN_PROGRESS','商家正在执行数据维护，请完成后再修改营业状态');
  const merchant=(await c.query('UPDATE merchants SET status=$1 WHERE id=$2 RETURNING *',[body.status,id])).rows[0];ensure(merchant,404,'NOT_FOUND','商家不存在');
  await c.query("INSERT INTO platform_audit(platform_user_id,merchant_id,action,detail) VALUES($1,$2,'merchant.status',$3)",[user.id,id,JSON.stringify(body)]);
  await c.query("SELECT pg_notify('saas_access',$1)",[JSON.stringify({merchant_id:id})]);return merchant;
 });
}));
platformRouter.get('/merchants/:id/invite',platformRoute(async(req)=>{
 const id=z.uuid().parse(req.params.id);const row=(await platformPool.query("SELECT id,expires_at,used_at,CASE WHEN used_at IS NOT NULL THEN 'activated' WHEN expires_at<=now() THEN 'expired' ELSE 'pending' END AS status FROM owner_invites WHERE merchant_id=$1 ORDER BY expires_at DESC LIMIT 1",[id])).rows[0];ensure(row,404,'NOT_FOUND','商家邀请不存在');return row;
}));
for(const mode of ['reissue','revoke'] as const)platformRouter.post('/merchants/:id/invite/'+mode,platformRoute(async(req,user)=>{
 const id=z.uuid().parse(req.params.id);z.object({}).strict().parse(req.body??{});
 return platformTransaction(async c=>{
  // Activation locks this same invitation row, so replacement cannot race an owner activation.
  const row=(await c.query('SELECT * FROM owner_invites WHERE merchant_id=$1 ORDER BY expires_at DESC LIMIT 1 FOR UPDATE',[id])).rows[0];ensure(row,404,'NOT_FOUND','商家邀请不存在');ensure(!row.used_at,409,'OWNER_ALREADY_ACTIVATED','老板账号已激活，不能重新创建老板邀请');
  if(mode==='revoke'){
   const revoked=(await c.query('UPDATE owner_invites SET expires_at=now() WHERE id=$1 RETURNING id,expires_at,used_at',[row.id])).rows[0];await c.query("INSERT INTO platform_audit(platform_user_id,merchant_id,action,detail) VALUES($1,$2,'owner.invite.revoked',$3)",[user.id,id,JSON.stringify({invite_id:row.id})]);return {...revoked,status:'expired'};
  }
  ensure((await c.query('SELECT status FROM merchants WHERE id=$1',[id])).rows[0]?.status==='active',409,'MERCHANT_SUSPENDED','请先恢复商家后再生成邀请');
  const token=randomToken(),invite=(await c.query("UPDATE owner_invites SET token_hash=$1,expires_at=now()+interval '7 days',created_by=$2 WHERE id=$3 RETURNING id,expires_at,used_at",[digest(token),user.id,row.id])).rows[0];await c.query("INSERT INTO platform_audit(platform_user_id,merchant_id,action,detail) VALUES($1,$2,'owner.invite.reissued',$3)",[user.id,id,JSON.stringify({invite_id:row.id})]);return {...invite,status:'pending',activation_url:`${process.env.PUBLIC_ORIGIN}/activate?token=${encodeURIComponent(token)}`};
 });
}));
platformRouter.get('/audit',platformRoute(async()=>({items:(await platformPool.query('SELECT * FROM platform_audit ORDER BY id DESC LIMIT 200')).rows})));
platformRouter.get('/support-grants',platformRoute(async(_req,user)=>({items:(await platformPool.query('SELECT g.*,m.name AS merchant_name FROM support_grants g JOIN merchants m ON m.id=g.merchant_id WHERE platform_user_id=$1 ORDER BY created_at DESC',[user.id])).rows})));
platformRouter.post('/merchants/:id/admin-session',platformRoute(async(req,user,claims)=>{
 const mid=z.uuid().parse(req.params.id);z.object({}).strict().parse(req.body??{});
 const adminClaims:Claims={realm:'support',uid:user.id,sid:claims.sid,version:claims.version,mid,platform_admin:true};
 return inTenant(mid,async()=>{
  ensure((await tenantQuery('SELECT 1 FROM merchants WHERE id=$1',[mid])).rowCount,404,'NOT_FOUND','商家不存在');
  await tenantQuery(`INSERT INTO merchant_users(username,password,name,role,active,platform_user_id)
   VALUES($1,'platform-identity-no-password',$2,'employee',1,$3)
   ON CONFLICT(merchant_id,platform_user_id) WHERE platform_user_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name`,['platform-'+randomUUID(),`平台超管 · ${user.name}`,user.id]);
  const actor=await authorize(adminClaims,undefined);await audit('platform.superadmin.started');
  return bootstrap(actor,signToken(adminClaims));
 });
}));
platformRouter.post('/support-grants/:id/session',platformRoute(async(req,user,claims)=>{
 const grant=(await platformPool.query('SELECT * FROM support_grants WHERE id=$1 AND platform_user_id=$2 AND revoked_at IS NULL AND expires_at>now()',[z.uuid().parse(req.params.id),user.id])).rows[0];ensure(grant,403,'SUPPORT_EXPIRED','支持授权不存在或已失效');
 const supportClaims:Claims={realm:'support',uid:user.id,sid:claims.sid,version:claims.version,mid:grant.merchant_id,grant:grant.id};
 return inTenant(grant.merchant_id,async()=>{const actor=await authorize(supportClaims,undefined,{support:'read'});await audit('support.started');return bootstrap(actor,signToken(supportClaims))});
}));
merchantRouter.post('/auth/activate',reply(async req=>{
 const body=z.object({token:z.string().min(40).max(100),username:AccountName,password:Password,name:z.string().trim().min(1).max(100)}).strict().parse(req.body);
 const password=await hashPassword(body.password);
 const activated=(await platformPool.query('SELECT * FROM activate_owner($1,$2,$3,$4)',[digest(body.token),body.username,password,body.name])).rows[0];
 return {activated:true,...activated};
}));
merchantRouter.post('/auth/login',reply(async req=>{
 const body=MerchantLogin.parse(req.body);
 return rateLimited('merchant:'+digest(body.merchant_code+'\0'+body.username),async c=>{
  const merchant=(await c.query('SELECT id FROM merchants WHERE code=$1',[body.merchant_code])).rows[0];
  if(!merchant){await verifyPassword(body.password,dummyPassword);throw new HttpError(401,'LOGIN_FAILED','商家编号、账号或密码错误')}
  return inTenant(merchant.id,async()=>{
   const user=(await tenantQuery('SELECT * FROM merchant_users WHERE username=$1 AND platform_user_id IS NULL FOR UPDATE',[body.username])).rows[0];
   const valid=await verifyPassword(body.password,user?.password??dummyPassword);ensure(user?.active===1&&valid,401,'LOGIN_FAILED','商家编号、账号或密码错误');
   const sid=randomUUID();await tenantQuery("INSERT INTO merchant_sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[sid,user.id]);
   const claims:Claims={realm:'merchant',mid:merchant.id,uid:user.id,sid,version:user.token_version};
   const actor=await authorize(claims,undefined);await audit('auth.login');return bootstrap(actor,signToken(claims));
  });
 });
}));
merchantRouter.get('/session',merchantRoute({support:'read'},async(_req,actor)=>bootstrap(actor)));
merchantRouter.post('/auth/logout',merchantRoute({},async(_req,actor)=>{await tenantQuery('UPDATE merchant_sessions SET revoked_at=now() WHERE id=$1',[actor.claims.sid]);await audit('auth.logout');await event('access.revoked',actor.user.id);return {logged_out:true}}));
merchantRouter.post('/auth/password',merchantRoute({},async(req,actor)=>{
 const body=z.object({current_password:z.string().max(128),new_password:Password}).strict().parse(req.body);
 const user=(await tenantQuery('SELECT * FROM merchant_users WHERE id=$1 FOR UPDATE',[actor.user.id])).rows[0];
 ensure(await verifyPassword(body.current_password,user.password),400,'PASSWORD_MISMATCH','当前密码不正确');
 await tenantQuery('UPDATE merchant_users SET password=$1,token_version=token_version+1 WHERE id=$2',[await hashPassword(body.new_password),user.id]);
 await tenantQuery('UPDATE merchant_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[user.id]);
 await audit('auth.password.changed');await event('access.revoked',user.id);return {logged_out:true};
}));

