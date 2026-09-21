import {Router} from 'express';
import {z} from 'zod';
import {TemplateDefinition,TemplateType} from '@za-spa/contracts';
import {merchantRoute,audit,event,type Actor} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,canonical,input,idempotent,storeObject} from '../business.js';
import {digest} from '../security.js';
import {ensure} from '../errors.js';
import {merchantIdempotent} from '../services/merchant-requests.js';
import {lockMember} from '../services/wallet.js';
import {preserveItemIdentity} from '../services/inventory.js';
export const templatesRouter=Router();
const read={roles:['owner'],support:'read' as const},write={...read,write:true,support:'configuration' as const};
const targets=z.object({template_id:Id,version:Id,store_ids:z.array(Id).min(1).max(100).refine(v=>new Set(v).size===v.length,'目标门店不能重复')}).strict();
const destinations={item:{table:'items',column:'item_id'},member_level:{table:'member_levels',column:'member_level_id'},recharge_plan:{table:'recharge_plans',column:'recharge_plan_id'},coupon:{table:'coupon_profiles',column:'coupon_profile_id'}};
function requireTemplatePayload(definition:{type:TemplateType;payload:any}){if(definition.type==='item'&&definition.payload?.type==='service'&&Number(definition.payload?.duration)<=0)ensure(false,400,'INVALID_DURATION','服务类模板必须填写时长（大于 0 分钟）');return definition}
async function template(id:number,lock=false){const row=(await tenantQuery('SELECT * FROM merchant_templates WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];ensure(row,404,'TEMPLATE_NOT_FOUND','模板不存在或不属于本商家');return row}
templatesRouter.get('/catalog/templates',merchantRoute(read,async req=>{
 const type=req.query.type?TemplateType.parse(req.query.type):null;
 return (await tenantQuery('SELECT * FROM merchant_templates WHERE ($1::text IS NULL OR type=$1) ORDER BY id DESC',[type])).rows;
}));
templatesRouter.post('/catalog/templates',merchantRoute(write,async(req)=>merchantIdempotent(req,'template.save',async()=>{
 const body=z.object({id:Id.optional(),version:Id.optional(),type:TemplateType,payload:z.unknown()}).strict().parse(input(req));const definition=requireTemplatePayload(TemplateDefinition.parse({type:body.type,payload:body.payload}));
 const before=body.id?await template(body.id,true):null;
 if(before){ensure(before.active,409,'TEMPLATE_ARCHIVED','停用模板不可继续编辑');ensure(before.version===body.version,409,'VERSION_CONFLICT','模板已被其他终端修改，请刷新后重试');ensure(before.type===body.type,400,'TEMPLATE_TYPE_LOCKED','模板类型不能改变')}
 const row=before?(await tenantQuery('UPDATE merchant_templates SET name=$1,payload=$2,version=version+1,updated_at=now() WHERE id=$3 RETURNING *',[definition.payload.name,JSON.stringify(definition.payload),before.id])).rows[0]:
  (await tenantQuery('INSERT INTO merchant_templates(type,name,payload) VALUES($1,$2,$3) RETURNING *',[definition.type,definition.payload.name,JSON.stringify(definition.payload)])).rows[0];
 await audit('template.saved',{before,after:row},'merchant_template',row.id);await event('catalog.template',row.id,null);return row;
})));
templatesRouter.delete('/catalog/templates/:id',merchantRoute(write,async(req)=>merchantIdempotent(req,'template.archive:'+req.params.id,async()=>{
 const body=z.object({version:Id,reason:z.string().trim().min(1).max(500)}).strict().parse(input(req));const row=await template(Id.parse(req.params.id),true);ensure(row.version===body.version,409,'VERSION_CONFLICT','模板已变化，请刷新后重试');
 const after=(await tenantQuery('UPDATE merchant_templates SET active=false,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[row.id])).rows[0];await audit('template.archived',body,'merchant_template',row.id);await event('catalog.template',row.id,null);return after;
})));
async function preview(body:z.infer<typeof targets>,actor:Actor,lock:boolean){
 const row=await template(body.template_id,lock);ensure(row.active,409,'TEMPLATE_ARCHIVED','模板已停用');ensure(row.version===body.version,409,'VERSION_CONFLICT','模板已更新，请重新预览');
 const definition=requireTemplatePayload(TemplateDefinition.parse({type:row.type,payload:row.payload})),destination=destinations[definition.type],list=[];
 for(const storeId of [...body.store_ids].sort((a,b)=>a-b)){
  ensure(actor.stores.some(s=>s.id===storeId),403,'STORE_FORBIDDEN','目标门店未授权或不属于本商家');
  const store=(await tenantQuery('SELECT * FROM stores WHERE id=$1'+(lock?' FOR SHARE':''),[storeId])).rows[0];ensure(store&&store.status===1,409,'STORE_INACTIVE','目标门店不可用');
  const binding=(await tenantQuery('SELECT * FROM template_bindings WHERE template_id=$1 AND store_id=$2',[row.id,storeId])).rows[0];
  const current=binding?await storeObject(destination.table,binding[destination.column],storeId,lock):null;
  if(current&&'active' in current)ensure(current.active===1,409,'TARGET_ARCHIVED','已下发的门店配置被停用，请先在门店核对');
  if(current&&definition.type==='item')await preserveItemIdentity(current,definition.payload);
  const before=current?Object.fromEntries(Object.keys(definition.payload).map(k=>[k,current[k]])):null;
  list.push({store_id:storeId,store_name:store.name,target_id:current?.id??null,action:!current?'create':canonical(before)===canonical(definition.payload)?'unchanged':'update',before,after:definition.payload});
 }
 const previewHash=digest(canonical({merchant_id:actor.merchant.id,template_id:row.id,version:row.version,targets:list}));return {template:row,preview_hash:previewHash,targets:list};
}
templatesRouter.post('/catalog/preview',merchantRoute({...read,snapshot:true},async(req,a)=>preview(targets.parse(input(req)),a,false)));
templatesRouter.post('/catalog/distribute',merchantRoute(write,async(req,a)=>merchantIdempotent(req,'template.distribute',async()=>{
 const {preview_hash,...body}=targets.extend({preview_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(input(req));const plan=await preview(body,a,true);
 ensure(plan.preview_hash===preview_hash,409,'PREVIEW_CHANGED','模板、目标门店或门店配置已变化，请重新预览');
 const destination=destinations[plan.template.type as TemplateType];let changed=0;
 for(const target of plan.targets){
  let id=target.target_id;const columns=Object.keys(target.after),parameters=Object.values(target.after);
  if(target.action==='create'){
   const extra=plan.template.type==='item'?{stock:(target.after as any).type==='product'?0:-1}:{};const all={...target.after,...extra},names=Object.keys(all);
   id=(await tenantQuery(`INSERT INTO ${destination.table}(store_id,${names.join(',')}) VALUES($1,${names.map((_,i)=>'$'+(i+2)).join(',')}) RETURNING id`,[target.store_id,...Object.values(all)])).rows[0].id;changed++;
  }else if(target.action==='update'){
   await tenantQuery(`UPDATE ${destination.table} SET ${columns.map((n,i)=>`${n}=$${i+1}`).join(',')} WHERE id=$${parameters.length+1} AND store_id=$${parameters.length+2}`,[...parameters,id,target.store_id]);changed++;
  }
  await tenantQuery(`INSERT INTO template_bindings(store_id,template_id,type,${destination.column},template_version,last_applied) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(merchant_id,store_id,template_id) DO UPDATE SET template_version=excluded.template_version,last_applied=excluded.last_applied,applied_at=now()`,[target.store_id,plan.template.id,plan.template.type,id,plan.template.version,JSON.stringify(target.after)]);
  await event('catalog.distributed',plan.template.id,target.store_id);
 }
 await audit('template.distributed',plan,'merchant_template',plan.template.id);return {...plan,stores:plan.targets.length,distributed:changed};
})));
templatesRouter.get('/catalog/distribution',merchantRoute(read,async(req)=>{
 const id=Id.parse(req.query.template_id);await template(id);return (await tenantQuery('SELECT b.*,s.name AS store_name FROM template_bindings b JOIN stores s ON s.merchant_id=b.merchant_id AND s.id=b.store_id WHERE b.template_id=$1 ORDER BY b.store_id',[id])).rows;
}));
templatesRouter.get('/coupon-profiles',merchantRoute({store:true,roles:['manager'],support:'read'},async(_req,a)=>(await tenantQuery('SELECT * FROM coupon_profiles WHERE store_id=$1 ORDER BY id',[a.storeId])).rows));
templatesRouter.post('/coupon-profiles/:id/issue',merchantRoute({store:true,write:true,roles:['manager'],action:'discount'},async(req,a)=>idempotent(req,'coupon-profile.issue:'+req.params.id,async()=>{
 const b=z.object({member_id:Id}).strict().parse(input(req)),profile=await storeObject('coupon_profiles',Id.parse(req.params.id),a.storeId!,true);ensure(profile.active===1,409,'PROFILE_ARCHIVED','优惠券配置已停用');await lockMember(b.member_id);
 const row=(await tenantQuery('INSERT INTO coupons(store_id,member_id,name,type,value,min_amount,expire_at) VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval \'1 day\') RETURNING *',[a.storeId,b.member_id,profile.name,profile.type,profile.value,profile.min_amount,profile.valid_days])).rows[0];
 await audit('coupon.issued_from_profile',{profile_id:profile.id,member_id:b.member_id},'coupon',row.id);await event('coupon.changed',row.id);return row;
})));
