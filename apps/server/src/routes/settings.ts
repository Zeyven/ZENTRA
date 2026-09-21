import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,PositiveMoney,input,storeObject} from '../business.js';
import {ensure} from '../errors.js';
export const settingsRouter=Router();
const text=z.string().max(500),flag=z.enum(['0','1']),positive=z.string().refine(s=>/^\d+(\.\d{1,2})?$/.test(s)&&Number(s)<=1000000,'数值格式错误');
function json<T extends z.ZodType>(schema:T){return z.string().max(32000).transform((s,ctx)=>{try{return JSON.parse(s)}catch{ctx.addIssue({code:'custom',message:'JSON 配置格式错误'});return z.NEVER}}).pipe(schema).transform(v=>JSON.stringify(v))}
const settingsShape=z.object({
 store_name:text,store_address:text,store_phone:text,open_hours:text,
 points_rate:positive.refine(s=>Number(s)<=1000),member_day:z.string().refine(s=>s===''||/^\d{1,2}$/.test(s)&&Number(s)>=1&&Number(s)<=31),
 clock_confirmation_mode:flag,clock_reminder_minutes:positive,clock_auto_finish:flag,
 pay_methods:json(z.array(z.string().trim().min(1).max(40)).min(1).max(30)),
 discount_schemes:json(z.array(z.object({id:Id,name:z.string().min(1).max(100),type:z.enum(['rate','amount']),value:PositiveMoney}).strict().refine(v=>v.type!=='rate'||v.value<=1)).max(100)),
 commission_tiers:json(z.array(z.object({min:z.number().nonnegative(),max:z.number().nonnegative().optional(),rate:z.number().gt(0,'提成档位比例必须大于 0').max(100)}).strict()).max(100)),
 approval_thresholds:json(z.object({refund:PositiveMoney,discount:PositiveMoney,inventory_adjustment:PositiveMoney}).strict()),
 booking_deposit_type:z.enum(['fixed','percent']),booking_deposit_value:positive,booking_payment_timeout_minutes:positive.refine(s=>Number(s)>=1&&Number(s)<=1440),
 booking_free_cancel_hours:positive,booking_late_cancel_fee_percent:positive.refine(s=>Number(s)<=100),
}).partial().strict();
const cashierKeys=new Set(['store_name','store_address','store_phone','pay_methods','discount_schemes','points_rate','member_day']);
const defaults={pay_methods:JSON.stringify(['现金','微信','支付宝','银行卡','会员卡']),points_rate:'1',clock_confirmation_mode:'0'};
async function read(storeId:number,cashier=false){const rows=(await tenantQuery('SELECT key,value FROM settings WHERE store_id=$1',[storeId])).rows;return {...defaults,...Object.fromEntries(rows.filter(r=>!cashier||cashierKeys.has(r.key)).map(r=>[r.key,r.value]))}}
settingsRouter.get('/settings',merchantRoute({store:true,roles:['manager'],support:'read'},async(_req,actor)=>read(actor.storeId!)));
settingsRouter.get('/settings/cashier',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(_req,actor)=>read(actor.storeId!,true)));
settingsRouter.post('/settings',merchantRoute({store:true,roles:['manager'],support:'configuration',write:true},async(req,actor)=>{
 const body=settingsShape.parse(input(req));
 if(body.approval_thresholds!==undefined)ensure(actor.role==='owner',403,'OWNER_REQUIRED','审批阈值仅商家老板可修改');
 for(const [key,value] of Object.entries(body))await tenantQuery('INSERT INTO settings(store_id,key,value) VALUES($1,$2,$3) ON CONFLICT(merchant_id,store_id,key) DO UPDATE SET value=excluded.value',[actor.storeId,key,value]);
 if(body.store_name!==undefined){ensure(body.store_name.trim(),400,'INVALID_NAME','门店名称不能为空');await tenantQuery('UPDATE stores SET name=$1 WHERE id=$2',[body.store_name.trim(),actor.storeId]);await event('stores.changed',actor.storeId,null)}
 await audit('settings.updated',body);await event('settings.changed');return read(actor.storeId!);
}));
settingsRouter.get('/audit-logs',merchantRoute({store:true,roles:['manager'],support:'read'},async(req,actor)=>{
 const limit=z.coerce.number().int().min(1).max(200).default(100).parse(req.query.limit);return (await tenantQuery(`SELECT a.*,u.name AS user_name,a.action AS type,a.detail::text AS content FROM audit_events a LEFT JOIN merchant_users u ON u.merchant_id=a.merchant_id AND u.id=a.user_id WHERE a.store_id=$1 ORDER BY a.id DESC LIMIT $2`,[actor.storeId,limit])).rows;
}));
settingsRouter.get('/announcements',merchantRoute({store:true,support:'read'},async(_req,actor)=>(await tenantQuery('SELECT * FROM announcements WHERE store_id=$1 ORDER BY id DESC LIMIT 200',[actor.storeId])).rows));
settingsRouter.post('/announcements',merchantRoute({store:true,roles:['manager'],write:true},async(req,actor)=>{
 const b=z.object({id:Id.optional(),title:z.string().trim().min(1).max(100),content:z.string().max(4000).default(''),active:z.union([z.literal(0),z.literal(1)]).default(1)}).strict().parse(input(req));
 if(b.id)await storeObject('announcements',b.id,actor.storeId!,true);
 const row=b.id?(await tenantQuery('UPDATE announcements SET title=$1,content=$2,active=$3 WHERE id=$4 AND store_id=$5 RETURNING *',[b.title,b.content,b.active,b.id,actor.storeId])).rows[0]:(await tenantQuery('INSERT INTO announcements(store_id,title,content,active) VALUES($1,$2,$3,$4) RETURNING *',[actor.storeId,b.title,b.content,b.active])).rows[0];
 await audit('announcement.saved',b,'announcement',row.id);await event('announcements.changed',row.id);return row;
}));
settingsRouter.delete('/announcements/:id',merchantRoute({store:true,roles:['manager'],write:true},async(req,actor)=>{const id=Id.parse(req.params.id);await storeObject('announcements',id,actor.storeId!,true);await tenantQuery('UPDATE announcements SET active=0 WHERE id=$1',[id]);await audit('announcement.archived',{},'announcement',id);await event('announcements.changed',id);return {id,archived:true}}));
