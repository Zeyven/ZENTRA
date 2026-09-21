import type {Request,RequestHandler} from 'express';
import {randomUUID} from 'node:crypto';
import {context,inTenant,platformPool,tenantQuery} from './db/pools.js';
import {ensure} from './errors.js';
import {readToken,type Claims} from './security.js';
import {defaultPages,defaultActions,actionCeilings,effectiveOperations,routeOperation} from '@za-spa/contracts';
import {enforceRoutePages} from './services/page-access.js';
export interface Actor{claims:Claims;merchant:any;user:any;stores:any[];storeId?:number;role:string;pages:string[];actions:string[];operations:string[];technicianId?:number;supportScope?:string}
export interface Access{write?:boolean;store?:boolean;owner?:boolean;roles?:string[];support?:'read'|'configuration';action?:string;snapshot?:boolean}
export const roleActions=defaultActions;
export function bearer(req:Request){const value=req.headers.authorization;ensure(value&&value.startsWith('Bearer '),401,'LOGIN_REQUIRED','请先登录');return value.slice(7)}
export function selectedStore(req:Request):number|undefined{
 const values=[req.headers['x-store-id'],req.query.store_id,req.body?.store_id].filter(v=>v!==undefined&&v!==null&&v!=='');
 if(!values.length)return undefined;
 ensure(values.every(v=>typeof v==='string'||typeof v==='number'),400,'INVALID_STORE','门店编号格式错误');
 const ids=values.map(Number);ensure(ids.every(v=>Number.isSafeInteger(v)&&v>0)&&ids.every(v=>v===ids[0]),400,'INVALID_STORE','门店选择不一致');return ids[0];
}
export async function checkPlatform(claims:Claims){
 const user=(await platformPool.query(`SELECT u.id,u.username,u.name,u.token_version FROM platform_users u
 JOIN platform_sessions s ON s.user_id=u.id WHERE u.id=$1 AND u.active=true AND u.token_version=$2
 AND s.id=$3 AND s.revoked_at IS NULL AND s.expires_at>now()`,[claims.uid,claims.version,claims.sid])).rows[0];
 ensure(user,401,'INVALID_SESSION','平台登录已失效');return user;
}
export async function authorize(claims:Claims,storeId:number|undefined,access:Access={}):Promise<Actor>{
 ensure(claims.mid===context().merchantId,403,'TENANT_MISMATCH','商家身份不匹配');
 const merchant=(await tenantQuery('SELECT id,code,name,status,member_mode FROM merchants WHERE id=$1',[claims.mid])).rows[0];
 ensure(merchant,401,'INVALID_MERCHANT','商家不存在');
 let user:any,stores:any[],supportScope:string|undefined;
 if(claims.realm==='support'){
  user=await checkPlatform({...claims,realm:'platform'});
  if(claims.platform_admin===true){
   ensure(!claims.grant,401,'INVALID_SESSION','平台管理会话类型不正确');
   const identity=(await tenantQuery('SELECT id,username,token_version FROM merchant_users WHERE platform_user_id=$1',[user.id])).rows[0];
   ensure(identity,401,'INVALID_SESSION','请从平台重新进入商家管理');
   user={...identity,name:`平台超管 · ${user.name}`,role:'owner',platform_operator_id:claims.uid};
   supportScope='platform_admin';
   stores=(await tenantQuery("SELECT *, 'owner' AS role FROM stores ORDER BY id")).rows;
  }else{
  const grant=(await tenantQuery(`SELECT * FROM support_grants WHERE id=$1 AND platform_user_id=$2 AND revoked_at IS NULL AND expires_at>now()`,[claims.grant,claims.uid])).rows[0];
  ensure(grant,403,'SUPPORT_EXPIRED','支持授权已失效');supportScope=grant.scope;
  if(supportScope==='maintenance'){
   const owner=(await tenantQuery("SELECT id,username,name,role,token_version FROM merchant_users WHERE id=$1 AND role='owner' AND active=1",[grant.owner_id])).rows[0];
   ensure(owner,403,'SUPPORT_EXPIRED','授权老板账号已失效');
   user={...owner,name:`平台维护 · ${user.name}`,platform_operator_id:claims.uid};
   stores=(await tenantQuery("SELECT *, 'owner' AS role FROM stores ORDER BY id")).rows;
  }else{
   ensure(access.support&&(access.support==='read'||supportScope==='configuration'),403,'SUPPORT_FORBIDDEN','支持会话没有此操作权限');
   user={...user,role:'support'};
   stores=(await tenantQuery("SELECT *, 'support' AS role FROM stores ORDER BY id")).rows;
  }
  }
 }else{
  ensure(claims.realm==='merchant',401,'WRONG_REALM','需要商家账号');
  user=(await tenantQuery(`SELECT u.id,u.username,u.name,u.role,u.token_version FROM merchant_users u
   JOIN merchant_sessions s ON s.merchant_id=u.merchant_id AND s.user_id=u.id
   WHERE u.id=$1 AND u.platform_user_id IS NULL AND u.active=1 AND u.token_version=$2 AND s.id=$3 AND s.revoked_at IS NULL AND s.expires_at>now()`,[claims.uid,claims.version,claims.sid])).rows[0];
  ensure(user,401,'INVALID_SESSION','登录或账号授权已失效');
  stores=user.role==='owner'?(await tenantQuery("SELECT *, 'owner' AS role FROM stores ORDER BY id")).rows:
   (await tenantQuery(`SELECT s.*,g.role,g.technician_id,g.pages,g.actions,g.operations FROM stores s JOIN staff_store_grants g ON g.merchant_id=s.merchant_id AND g.store_id=s.id WHERE g.user_id=$1 AND s.status=1 ORDER BY s.id`,[user.id])).rows;
 }
 ensure(merchant.status==='active'||user.role==='owner',403,'MERCHANT_SUSPENDED','商家已停用');
 if(access.write&&supportScope!=='platform_admin')ensure(merchant.status==='active',403,'MERCHANT_SUSPENDED','商家已停用，老板仅可查看和导出');
 if(access.owner)ensure(user.role==='owner',403,'OWNER_REQUIRED','需要商家老板权限');
 if(access.store)ensure(storeId,400,'STORE_REQUIRED','请先选择门店');
 const store=storeId?stores.find(s=>s.id===storeId):undefined;
 if(storeId){ensure(store,403,'STORE_FORBIDDEN','没有此门店的访问权限');if(access.write&&supportScope!=='platform_admin')ensure(store.status===1,409,'STORE_INACTIVE','门店已停用')}
 const role=user.role==='owner'?'owner':user.role==='support'?'support':store?.role??'employee';
 if(role==='technician')ensure(store?.technician_id,403,'TECHNICIAN_REQUIRED','技师账号未关联本门店的技师档案');
 const permissions=storeId&&!['owner','support'].includes(role)?(await tenantQuery('SELECT kind,perm_key,enabled FROM role_permissions WHERE store_id=$1 AND role=$2',[storeId,role])).rows:[];
 const pages=(defaultPages[role]??[]).filter(page=>permissions.find(p=>p.kind==='page'&&p.perm_key===page)?.enabled!==0 && (!store?.pages||store.pages.includes(page)));
 const actions=(store?.actions??[...new Set([...(roleActions[role]??[]),...permissions.filter(p=>p.kind==='action'&&p.enabled===1).map(p=>p.perm_key)])]).filter((action:string)=>actionCeilings[role]?.includes(action)&&permissions.find(p=>p.kind==='action'&&p.perm_key===action)?.enabled!==0&&(!store?.actions||store.actions.includes(action)));
 if(access.store)ensure(pages.length>0,403,'MODULE_FORBIDDEN','该门店没有可用的功能授权');
 if(access.roles)ensure(role==='owner'||role==='support'||access.roles.includes(role),403,'ACTION_FORBIDDEN','没有此操作权限');
 if(access.action&&role!=='owner'){
  ensure(role!=='support',403,'SUPPORT_FORBIDDEN','支持会话不能执行经营资产操作');
  ensure(actions.includes(access.action),403,'ACTION_FORBIDDEN','没有此操作权限');
 }
 Object.assign(context(),{userId:claims.realm==='support'&&!['maintenance','platform_admin'].includes(supportScope??'')?undefined:user.id,platformUserId:claims.realm==='support'?claims.uid:undefined,role,storeId,supportGrant:claims.grant,platformAdmin:supportScope==='platform_admin'});
 return {claims,merchant,user,stores,storeId,role,pages,actions:actions.filter((a:string)=>actionCeilings[role]?.includes(a)),operations:role==='support'&&supportScope!=='configuration'?[]:effectiveOperations(role,pages,store?.operations),technicianId:store?.technician_id,supportScope};
}
export function merchantRoute(access:Access,handler:(req:Request,actor:Actor)=>Promise<unknown>):RequestHandler{
 return async(req,res,next)=>{try{
  const claims=readToken(bearer(req),'merchant');ensure(claims.mid,401,'INVALID_SESSION','登录缺少商家信息');
  if(claims.realm==='support')ensure((req.method==='GET'||!req.path.startsWith('/support/'))&&!req.path.startsWith('/auth/'),403,'SUPPORT_FORBIDDEN','平台维护不能代替老板续授支持权限或修改登录凭证');
  const storeId=selectedStore(req);
  const data=await inTenant(claims.mid,async()=>{const actor=await authorize(claims,storeId,access);res.locals.diagnosticScope={merchantId:claims.mid,storeId:actor.storeId,userId:claims.realm==='merchant'?actor.user.id:undefined};enforceRoutePages(actor,req.path,req.method);const operation=routeOperation(req.path,req.method);if(operation&&actor.role!=='owner')ensure(actor.operations.includes(operation),403,'OPERATION_FORBIDDEN','该门店未授权此操作，请联系商家老板');const result=await handler(req,actor);
   if(claims.realm==='support')await audit(claims.platform_admin?'platform.superadmin.access':'support.access',{method:req.method,path:req.path},undefined,undefined);
   return result},{},access.snapshot);
  if(data&&typeof data==='object'&&'pending_approval' in data&&data.pending_approval){res.status(202).json({ok:false,...data});return}
  res.json({ok:true,data});
 }catch(error){next(error)}};
}
export function platformRoute(handler:(req:Request,user:any,claims:Claims)=>Promise<unknown>):RequestHandler{
 return async(req,res,next)=>{try{const claims=readToken(bearer(req),'platform');const user=await checkPlatform(claims);res.json({ok:true,data:await handler(req,user,claims)})}catch(error){next(error)}};
}
export async function audit(action:string,detail:unknown={},objectType?:string,objectId?:string|number){
 const c=context();await tenantQuery(`INSERT INTO audit_events(store_id,user_id,platform_user_id,support_grant_id,action,object_type,object_id,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[c.storeId??null,c.userId??null,c.platformUserId??null,c.supportGrant??null,action,objectType??null,objectId===undefined?null:String(objectId),JSON.stringify(detail)]);
}
export async function event(topic:string,objectId?:string|number,storeId:number|null=context().storeId??null){
 return (await tenantQuery('INSERT INTO domain_events(store_id,topic,object_id) VALUES($1,$2,$3) RETURNING id',[storeId,topic,objectId===undefined?null:String(objectId)])).rows[0];
}
export function bootstrap(actor:Actor,token?:string){return {protocol_version:1,realm:actor.claims.realm,token,merchant:{...actor.merchant,mode:actor.merchant.member_mode},user:actor.user,stores:actor.stores,current_store_id:actor.storeId??actor.stores.find(s=>s.status===1)?.id??(actor.supportScope==='platform_admin'?actor.stores[0]?.id:null)??null,support:actor.claims.realm==='support'?{id:actor.claims.grant??`platform:${actor.claims.uid}:${actor.claims.sid}`,scope:actor.supportScope}:null}}
