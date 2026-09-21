import {Router} from 'express';
import {z} from 'zod';
import {AccountName,Password,StoreRole,defaultPages,actionCeilings,defaultOperations} from '@za-spa/contracts';
import {audit,event,merchantRoute} from '../access.js';
import {tenantQuery,platformPool} from '../db/pools.js';
import {ensure} from '../errors.js';
import {hashPassword} from '../security.js';
import {visibleTopic} from '../services/page-access.js';
export const organizationRouter=Router();
organizationRouter.get('/realtime/events',merchantRoute({store:true,support:'read'},async(req,actor)=>{
 const after=z.coerce.number().int().nonnegative().default(0).parse(req.query.after);
 const rows=(await tenantQuery(`SELECT id,topic,store_id,created_at FROM domain_events WHERE id>$1 AND (store_id=$2 OR store_id IS NULL)
 AND ($3::boolean=false OR topic ~ '^(clock|technician|session|room-warning|access)') ORDER BY id LIMIT 200`,[after,actor.storeId,actor.role==='technician'])).rows;
 return {items:rows.filter(r=>visibleTopic(r.topic,actor)),next_cursor:rows.at(-1)?.id??after,has_more:rows.length===200};
}));
const idSchema=z.coerce.number().int().positive();
const storeShape=z.object({code:z.string().trim().min(1).max(40),name:z.string().trim().min(1).max(100),short_name:z.string().trim().max(40).optional(),point_clock_business_type:z.enum(['BATH','FOOT']).nullable().optional()}).strict();
organizationRouter.get('/stores',merchantRoute({support:'read'},async(_req,actor)=>actor.stores));
organizationRouter.post('/stores',merchantRoute({write:true,owner:true},async req=>{
 const b=storeShape.parse(req.body);
 const store=(await tenantQuery('INSERT INTO stores(code,name,short_name,point_clock_business_type) VALUES($1,$2,$3,$4) RETURNING *',[b.code,b.name,b.short_name??null,b.point_clock_business_type??null])).rows[0];
 await audit('store.created',b,'store',store.id);await event('stores.changed',store.id,null);return store;
}));
organizationRouter.put('/stores/:id',merchantRoute({write:true,owner:true},async req=>{
 const id=idSchema.parse(req.params.id),b=storeShape.omit({code:true}).extend({status:z.union([z.literal(0),z.literal(1)]).optional()}).parse(req.body);
 const current=(await tenantQuery('SELECT * FROM stores WHERE id=$1 FOR UPDATE',[id])).rows[0];ensure(current,404,'NOT_FOUND','门店不存在');
 const changingPointClockType=Object.hasOwn(b,'point_clock_business_type')&&b.point_clock_business_type!==current.point_clock_business_type;
 if(changingPointClockType){
  const activeGateway=(await tenantQuery('SELECT 1 FROM hardware_gateways WHERE store_id=$1 AND revoked_at IS NULL AND expires_at>now() LIMIT 1',[id])).rowCount;
  ensure(!activeGateway,409,'POINT_CLOCK_TYPE_IN_USE','已有有效的点钟王网关授权；请先停止本机网关并撤销授权，再修改门店业态');
 }
 const store=(await tenantQuery(`UPDATE stores SET name=$1,
  short_name=CASE WHEN $2::boolean THEN $3 ELSE short_name END,
  status=coalesce($4,status),
  point_clock_business_type=CASE WHEN $5::boolean THEN $6 ELSE point_clock_business_type END
  WHERE id=$7 RETURNING *`,[b.name,Object.hasOwn(b,'short_name'),b.short_name??null,b.status??null,Object.hasOwn(b,'point_clock_business_type'),b.point_clock_business_type??null,id])).rows[0];
 await audit('store.updated',b,'store',id);await event('access.changed',id,null);return store;
}));
organizationRouter.delete('/stores/:id',merchantRoute({write:true,owner:true},async req=>{
 const id=idSchema.parse(req.params.id);
 const store=(await tenantQuery('SELECT id,code,name,status FROM stores WHERE id=$1 FOR UPDATE',[id])).rows[0];ensure(store,404,'NOT_FOUND','门店不存在');
 ensure(store.status===0,409,'STORE_ACTIVE','请先停用门店，再删除空门店');
 // Request diagnostics are not business history; rollback also restores them if any real relation prevents deletion.
 await tenantQuery('DELETE FROM maintenance_events WHERE store_id=$1',[id]);
 try{await tenantQuery('DELETE FROM stores WHERE id=$1',[id])}catch(error:any){if(error.code==='23503')ensure(false,409,'STORE_HAS_HISTORY','门店已有配置、授权或经营记录，不能删除；请保留停用状态');throw error}
 await audit('store.deleted',{code:store.code,name:store.name},'store',id);await event('access.changed',id,null);return {id,deleted:true};
}));
organizationRouter.get('/users',merchantRoute({owner:true},async()=>{
 const users=(await tenantQuery('SELECT id,username,name,role,active,created_at FROM merchant_users WHERE platform_user_id IS NULL ORDER BY id')).rows;
 const grants=(await tenantQuery('SELECT * FROM staff_store_grants ORDER BY user_id,store_id')).rows;
 return users.map(user=>({...user,store_grants:grants.filter(g=>g.user_id===user.id)}));
}));
organizationRouter.post('/users',merchantRoute({write:true,owner:true},async req=>{
 const b=z.object({username:AccountName,password:Password,name:z.string().trim().min(1).max(100)}).strict().parse(req.body);
 const user=(await tenantQuery("INSERT INTO merchant_users(username,password,name,role) VALUES($1,$2,$3,'employee') RETURNING id,username,name,role,active",[b.username,await hashPassword(b.password),b.name])).rows[0];
 await audit('user.created',{username:user.username,name:user.name},'user',user.id);return user;
}));
organizationRouter.patch('/users/:id',merchantRoute({write:true,owner:true},async(req,actor)=>{
 const id=idSchema.parse(req.params.id),b=z.object({name:z.string().trim().min(1).max(100).optional(),active:z.union([z.literal(0),z.literal(1)]).optional(),password:Password.optional()}).strict().parse(req.body);
 ensure(id!==actor.user.id||b.active!==0,400,'OWNER_DISABLE_DENIED','不能停用老板账号');
 const password=b.password?await hashPassword(b.password):null;
 const user=(await tenantQuery(`UPDATE merchant_users SET name=coalesce($1,name),active=coalesce($2,active),password=coalesce($3,password),token_version=token_version+1
 WHERE id=$4 AND platform_user_id IS NULL RETURNING id,username,name,role,active`,[b.name??null,b.active??null,password,id])).rows[0];ensure(user,404,'NOT_FOUND','员工不存在');
 await tenantQuery('UPDATE merchant_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[id]);
 await audit('user.updated',{name:b.name,active:b.active,password_changed:!!password},'user',id);await event('access.revoked',id,null);return user;
}));
organizationRouter.put('/users/:id/grants',merchantRoute({write:true,owner:true},async req=>{
 const id=idSchema.parse(req.params.id),b=z.object({grants:z.array(z.object({store_id:idSchema,role:StoreRole,technician_id:idSchema.nullable().optional(),pages:z.array(z.string()).max(50).optional(),actions:z.array(z.string()).max(50).optional(),operations:z.array(z.string()).max(50).nullable().optional()}).strict()).max(100)}).strict().parse(req.body);
 ensure(new Set(b.grants.map(g=>g.store_id)).size===b.grants.length,400,'DUPLICATE_GRANT','同一门店只能设置一个角色');
 const user=(await tenantQuery('SELECT id,role FROM merchant_users WHERE id=$1 AND platform_user_id IS NULL FOR UPDATE',[id])).rows[0];ensure(user,404,'NOT_FOUND','员工不存在');ensure(user.role==='employee',400,'OWNER_GRANT_DENIED','老板权限由商家身份确定，不能改为员工授权');
 const previous=(await tenantQuery('SELECT * FROM staff_store_grants WHERE user_id=$1',[id])).rows;
 const grants=b.grants.map(g=>{const old=previous.find(row=>row.store_id===g.store_id);return {...g,pages:g.pages??old?.pages?.filter((p:string)=>defaultPages[g.role].includes(p)),actions:g.actions??old?.actions?.filter((a:string)=>actionCeilings[g.role].includes(a)),operations:g.operations===undefined?old?.operations?.filter((o:string)=>defaultOperations[g.role].includes(o as any))??null:g.operations}});
 // Validate every target before removing any previous grants; transaction rollback covers all writes.
 for(const grant of grants){
  ensure(!grant.pages||grant.pages.every((p:string)=>defaultPages[grant.role].includes(p)),400,'PERMISSION_CEILING','功能授权超出该角色范围');
  ensure(!grant.actions||grant.actions.every((a:string)=>actionCeilings[grant.role].includes(a)),400,'PERMISSION_CEILING','操作授权超出该角色范围');
  ensure(!grant.operations||grant.operations.every((o:string)=>defaultOperations[grant.role].includes(o as any)),400,'PERMISSION_CEILING','日常操作授权超出该角色范围');
  ensure((await tenantQuery('SELECT 1 FROM stores WHERE id=$1',[grant.store_id])).rowCount,403,'STORE_FORBIDDEN','授权包含不存在或不可用的门店');
  if(grant.role==='technician')ensure(grant.technician_id,400,'TECHNICIAN_REQUIRED','技师账号必须关联该门店的技师档案');
 }
 await tenantQuery('DELETE FROM staff_store_grants WHERE user_id=$1',[id]);
 for(const grant of grants)await tenantQuery('INSERT INTO staff_store_grants(user_id,store_id,role,technician_id,pages,actions,operations) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,grant.store_id,grant.role,grant.role==='technician'?grant.technician_id:null,grant.pages??null,grant.actions??null,grant.operations??null]);
 await audit('user.grants.changed',{grants},'user',id);await event('access.changed',id,null);return {id,grants};
}));
organizationRouter.get('/support/operators',merchantRoute({owner:true},async()=>({items:(await platformPool.query('SELECT id,name FROM platform_users WHERE active=true ORDER BY id')).rows})));
organizationRouter.get('/support/grants',merchantRoute({owner:true},async()=>({items:(await tenantQuery('SELECT * FROM support_grants ORDER BY created_at DESC')).rows})));
organizationRouter.post('/support/grants',merchantRoute({owner:true},async(req,actor)=>{
 const b=z.object({platform_user_id:idSchema,scope:z.enum(['read','configuration','maintenance']).default('read'),duration_minutes:z.number().int().min(1).max(60).default(30)}).strict().parse(req.body);
 ensure((await platformPool.query('SELECT 1 FROM platform_users WHERE id=$1 AND active=true',[b.platform_user_id])).rowCount,404,'NOT_FOUND','平台支持人员不存在');
 const grant=(await tenantQuery("INSERT INTO support_grants(merchant_id,platform_user_id,owner_id,scope,expires_at) VALUES(require_merchant_id(),$1,$2,$3,now()+$4*interval '1 minute') RETURNING *",[b.platform_user_id,actor.user.id,b.scope,b.duration_minutes])).rows[0];
 await audit('support.granted',b,'support_grant',grant.id);await event('support.changed',grant.id,null);return grant;
}));
organizationRouter.delete('/support/grants/:id',merchantRoute({owner:true},async req=>{
 const id=z.uuid().parse(req.params.id);const grant=(await tenantQuery('UPDATE support_grants SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 RETURNING *',[id])).rows[0];ensure(grant,404,'NOT_FOUND','支持授权不存在');
 await audit('support.revoked',{},'support_grant',id);await event('access.revoked',id,null);return grant;
}));
organizationRouter.get('/audit-events',merchantRoute({roles:['manager'],support:'read'},async(req,actor)=>{
 const cursor=z.coerce.number().int().nonnegative().default(0).parse(req.query.after),limit=z.coerce.number().int().min(1).max(200).default(100).parse(req.query.limit);
 ensure(actor.role==='owner'||actor.role==='support'||actor.storeId,400,'STORE_REQUIRED','请选择门店');
 const rows=(await tenantQuery('SELECT * FROM audit_events WHERE id>$1 AND ($2::bigint IS NULL OR store_id=$2) ORDER BY id LIMIT $3',[cursor,actor.storeId??null,limit])).rows;return {items:rows,next_cursor:rows.at(-1)?.id??cursor};
}));


