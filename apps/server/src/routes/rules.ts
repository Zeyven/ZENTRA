import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,Money,PositiveMoney,input,idempotent,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {DateOnly} from '../services/dates.js';
import {calculatePrice} from '../services/pricing-engine.js';
import {calculateCommission} from '../services/commission-engine.js';
export const rulesRouter=Router();
const read={store:true,roles:['manager'],support:'read' as const};
const write={store:true,write:true,roles:['manager'],support:'configuration' as const};
const optionalText=z.string().trim().max(100).nullable().optional().transform(v=>v||null);
const optionalDate=z.union([DateOnly,z.literal('')]).nullable().optional().transform(v=>v||null);
const optionalTime=z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),z.literal('')]).nullable().optional().transform(v=>v||null);
const flag=z.union([z.boolean(),z.literal(0),z.literal(1)]).default(1).transform(v=>v?1:0);
const common={id:Id.optional(),version:Id.optional(),name:z.string().trim().min(1).max(100),priority:z.number().int().min(0).max(10000).default(100),effective_from:optionalDate,effective_to:optionalDate,reason:z.string().trim().max(500).optional()};
const pricing=z.object({...common,item_id:Id.nullable().optional(),weekdays:z.array(z.number().int().min(0).max(6)).max(7).default([]),start_time:optionalTime,end_time:optionalTime,room_type:optionalText,technician_level:optionalText,member_level:optionalText,adjustment_type:z.enum(['fixed','percent','override']),adjustment_value:Money,stack_mode:z.enum(['stack','stop']).default('stack'),enabled:flag}).strict().superRefine((v,c)=>{
 if(v.effective_from&&v.effective_to&&v.effective_from>v.effective_to)c.addIssue({code:'custom',message:'结束日期不能早于开始日期'});
 if(v.adjustment_type==='percent'&&(v.adjustment_value<=-100||v.adjustment_value>10000))c.addIssue({code:'custom',message:'调价比例须大于 -100% 且不超过 10000%'});
 if(v.adjustment_type==='override'&&v.adjustment_value<=0)c.addIssue({code:'custom',message:'指定成交价必须大于 0'});
});
const conditions=z.object({technician_ids:z.array(Id).max(200).optional(),technician_levels:z.array(z.string().max(100)).max(50).optional(),item_ids:z.array(Id).max(200).optional(),service_types:z.array(z.enum(['轮钟','点钟','加钟','半钟','排钟'])).max(5).optional(),min_amount:PositiveMoney.optional(),max_amount:PositiveMoney.optional(),min_count:z.number().int().nonnegative().max(1000000000).optional()}).strict();
const commission=z.object({...common,scope:z.literal('service').default('service'),conditions:conditions.default({}),action_type:z.enum(['rate','fixed','bonus']),action_value:PositiveMoney,stack_mode:z.enum(['first','stack']).default('first'),active:flag}).strict().superRefine((v,c)=>{
 if(v.effective_from&&v.effective_to&&v.effective_from>v.effective_to)c.addIssue({code:'custom',message:'结束日期不能早于开始日期'});
 if(v.action_value<=0)c.addIssue({code:'custom',message:'提成值必须大于 0'});
 if(v.action_type==='rate'&&v.action_value>100)c.addIssue({code:'custom',message:'提成率不能超过 100%'});
 if(v.conditions.min_amount!==undefined&&v.conditions.max_amount!==undefined&&v.conditions.min_amount>v.conditions.max_amount)c.addIssue({code:'custom',message:'业绩上限不能低于下限'});
});
function decode(row:any,kind:string){return kind==='pricing'?{...row,weekdays:JSON.parse(row.weekdays||'[]')}:{...row,conditions:JSON.parse(row.conditions||'{}')}}
for(const kind of ['pricing','commission'] as const){
 const table=kind+'_rules',path='/'+kind+'-rules';
 rulesRouter.get(path,merchantRoute(read,async(_req,a)=>(await tenantQuery(`SELECT * FROM ${table} WHERE store_id=$1 ORDER BY priority,id`,[a.storeId])).rows.map(r=>decode(r,kind))));
 rulesRouter.post(path,merchantRoute(write,async(req,a)=>idempotent(req,path+'.save',async()=>{
  const body=kind==='pricing'?pricing.parse(input(req)):commission.parse(input(req));
  const before=body.id?await storeObject(table,body.id,a.storeId!,true):null;
  if(before)ensure(body.version===before.version,409,'VERSION_CONFLICT','规则已被其他终端修改，请刷新后重试');
  if('item_id' in body&&body.item_id)await storeObject('items',body.item_id,a.storeId!);
  if('conditions' in body){for(const id of body.conditions.technician_ids??[])await storeObject('technicians',id,a.storeId!);for(const id of body.conditions.item_ids??[])await storeObject('items',id,a.storeId!)}
  const {id,version,reason,...values}=body;const data:Record<string,unknown>={...values};
  if('weekdays' in data)data.weekdays=JSON.stringify(data.weekdays);
  if('conditions' in data)data.conditions=JSON.stringify(data.conditions);
  const names=Object.keys(data),params=Object.values(data);
  const after=before?(await tenantQuery(`UPDATE ${table} SET ${names.map((n,i)=>`${n}=$${i+1}`).join(',')},version=version+1,updated_at=now() WHERE id=$${params.length+1} AND store_id=$${params.length+2} RETURNING *`,[...params,id,a.storeId])).rows[0]:
   (await tenantQuery(`INSERT INTO ${table}(store_id,created_by,${names.join(',')}) VALUES($1,$2,${names.map((_,i)=>'$'+(i+3)).join(',')}) RETURNING *`,[a.storeId,a.role==='support'?null:a.user.id,...params])).rows[0];
  await audit(kind+'.rule.saved',{reason,before,after},table,after.id);await event(kind+'-rule',after.id);return decode(after,kind);
 })));
 rulesRouter.delete(path+'/:id',merchantRoute(write,async(req,a)=>idempotent(req,path+'.disable:'+req.params.id,async()=>{
  const body=z.object({version:Id,reason:z.string().trim().min(1).max(500)}).strict().parse(input(req)),row=await storeObject(table,Id.parse(req.params.id),a.storeId!,true);
  ensure(row.version===body.version,409,'VERSION_CONFLICT','规则已变化，请刷新后重试');
  const after=(await tenantQuery(`UPDATE ${table} SET ${kind==='pricing'?'enabled':'active'}=0,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[row.id])).rows[0];
  await audit(kind+'.rule.disabled',{reason:body.reason,before:row},table,row.id);await event(kind+'-rule',row.id);return decode(after,kind);
 })));
}
rulesRouter.post('/pricing-rules/preview',merchantRoute({...read,snapshot:true},async(req,a)=>{
 const body=z.object({item_id:Id,room_id:Id.optional(),technician_id:Id.optional(),member_id:Id.optional(),at:z.string().datetime({offset:true}).optional()}).strict().parse(input(req));
 const item=await storeObject('items',body.item_id,a.storeId!);const room=body.room_id?await storeObject('rooms',body.room_id,a.storeId!):null,tech=body.technician_id?await storeObject('technicians',body.technician_id,a.storeId!):null;
 const member=body.member_id?(await tenantQuery("SELECT * FROM members WHERE id=$1 AND (store_id=$2 OR scope_store_id IS NULL)",[body.member_id,a.storeId])).rows[0]:null;
 if(body.member_id)ensure(member,404,'MEMBER_NOT_FOUND','会员不属于当前门店');
 const at=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(body.at?new Date(body.at):new Date());
 return calculatePrice({basePrice:item.price,rules:(await tenantQuery('SELECT * FROM pricing_rules WHERE store_id=$1 AND enabled=1',[a.storeId])).rows,context:{at,item_id:item.id,room_type:room?.room_type,technician_level:tech?.level,member_level:member?.level}});
}));
rulesRouter.post('/commission-rules/preview',merchantRoute({...read,snapshot:true},async(req,a)=>{
 const body=z.object({lines:z.array(z.object({id:z.union([Id,z.string().min(1).max(100)]),technician_id:Id,technician_level:z.string().max(100).optional(),item_id:Id,quantity:z.number().int().positive().max(100000).default(1),amount:PositiveMoney,clock_out_at:z.string().datetime({offset:true}),service_type:z.enum(['轮钟','点钟','加钟','半钟','排钟']),is_add_time:z.boolean().default(false)}).strict()).max(500),fallback:z.object({baseRate:z.number().min(0).max(100).optional(),wheelRate:z.number().min(0).max(100).optional(),dianzhongRate:z.number().min(0).max(100).optional(),halfRate:z.number().min(0).max(100).optional(),addTimeRate:z.number().min(0).max(100).optional(),dianzhongBonus:PositiveMoney.optional()}).strict().default({})}).strict().parse(input(req));
 for(const line of body.lines){const tech=await storeObject('technicians',line.technician_id,a.storeId!);await storeObject('items',line.item_id,a.storeId!);line.technician_level=tech.level;line.clock_out_at=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(line.clock_out_at))}
 return calculateCommission({...body,rules:(await tenantQuery('SELECT * FROM commission_rules WHERE store_id=$1 AND active=1',[a.storeId])).rows});
}));
