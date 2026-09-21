import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,PositiveMoney,input,storeObject,idempotent} from '../business.js';
import {ensure} from '../errors.js';
import {StockQuantity} from '@za-spa/contracts';
import {preserveItemIdentity} from '../services/inventory.js';
import {lockBandConfiguration} from '../services/wristbands.js';
export const catalogRouter=Router();
const name=z.string().trim().min(1).max(100),text=z.string().trim().max(200).nullable().optional();
const integer=z.number().int().min(0).max(1000000000),flag=z.union([z.literal(0),z.literal(1)]),rate=z.number().finite().min(0).max(100);
const configurations={
 rooms:z.object({room_no:name,room_name:text,room_type:name.default('足浴房'),capacity:integer.min(1).default(2),sort_order:integer.default(0)}),
 technicians:z.object({name,code:name,phone:text,level:name.default('普通'),base_salary:PositiveMoney.default(0),commission_rate:rate.default(0),wheel_rate:rate.default(0),dianzhong_rate:rate.default(0),half_rate:rate.default(0),dianzhong_bonus:PositiveMoney.default(0),add_time_rate:rate.default(0)}),
 categories:z.object({name,type:z.enum(['service','product']),sort_order:integer.default(0)}),
 items:z.object({name,category_id:Id.nullable().optional(),type:z.enum(['service','product']),price:PositiveMoney.refine(v=>v>0,'售价必须大于 0'),duration:integer.default(0),commission:PositiveMoney.default(0),stock:StockQuantity.or(z.literal(0)).or(z.literal(-1)).default(-1),low_stock_threshold:integer.default(10),cost:PositiveMoney.default(0),unit:name.default('份'),sold_out:flag.default(0),is_primary:flag.default(1)}),
 wristbands:z.object({code:name,deposit:PositiveMoney.default(0)}),
 member_levels:z.object({name,min_consume:PositiveMoney.default(0),discount:z.number().gt(0).lte(1).default(1),sort_order:integer.default(0)}),
 recharge_plans:z.object({name,amount:PositiveMoney,gift_amount:PositiveMoney.default(0),active:flag.default(1),sort_order:integer.default(0)}),
 suppliers:z.object({name,contact_name:text,phone:text,address:text,remark:text,active:flag.default(1)})
};
const softDelete=new Set(['rooms','technicians','items','recharge_plans','suppliers']);
for(const [table,shape] of Object.entries(configurations)){
 const path='/'+table.replaceAll('_','-');
 catalogRouter.get(path,merchantRoute({store:true,roles:table==='suppliers'?['manager']:['manager','floor'],support:'read'},async(req,actor)=>{
  const rows=(await tenantQuery(table==='wristbands'?'SELECT w.*,r.room_no,r.room_name FROM wristbands w LEFT JOIN rooms r ON r.merchant_id=w.merchant_id AND r.id=w.room_id WHERE w.store_id=$1 AND ($2::boolean OR w.active=1) ORDER BY w.id':`SELECT * FROM ${table} WHERE store_id=$1 ORDER BY id`,table==='wristbands'?[actor.storeId,req.query.include_inactive==='1']:[actor.storeId])).rows;
  if(actor.role==='floor'&&table==='technicians')return rows.map(({base_salary,commission_rate,wheel_rate,dianzhong_rate,half_rate,dianzhong_bonus,add_time_rate,phone,...row})=>row);
  if(actor.role==='floor'&&table==='items')return rows.map(({cost,commission,...row})=>row);return rows;
 }));
 catalogRouter.post(path,merchantRoute({write:true,store:true,roles:['manager'],support:'configuration'},async(req,actor)=>idempotent(req,'catalog.save:'+table,async()=>{
  const parsed=shape.extend({id:Id.optional()}).strict().parse(input(req));const {id,...values}=parsed;
  if(table==='items'&&(values as any).type==='service'&&Number((values as any).duration)<=0)ensure(false,400,'INVALID_DURATION','服务项目时长必须大于 0 分钟');
  if(table==='technicians'&&req.body&&Object.prototype.hasOwnProperty.call(req.body,'commission_rate')&&Number((req.body as any).commission_rate)===0)ensure(false,400,'INVALID_COMMISSION_RATE','技师基础提成必须大于 0');
  if(table==='wristbands')await lockBandConfiguration();
  const before=id?await storeObject(table,id,actor.storeId!,true):null;
  if(table==='wristbands'){
   const code=(values as {code:string}).code;
   const duplicate=(await tenantQuery('SELECT active FROM wristbands WHERE store_id=$1 AND code=$2 AND ($3::bigint IS NULL OR id<>$3)',[actor.storeId,code,id??null])).rows[0];
   ensure(!duplicate,409,duplicate?.active===0?'WRISTBAND_ARCHIVED':'WRISTBAND_EXISTS',duplicate?.active===0?`手牌 ${code} 已停用，请在手牌管理中删除旧档案后重新添加`:`手牌 ${code} 已存在，请刷新列表查看`);
   ensure(!(await tenantQuery('SELECT 1 FROM wristbands WHERE store_id=$1 AND ($2::bigint IS NULL OR id<>$2) AND card_uid=$3',[actor.storeId,id??null,code])).rowCount,409,'CARD_CONFLICT','手牌编号与已有芯片卡号冲突');
   if(before){ensure(before.status==='idle',409,'WRISTBAND_BUSY','手牌仍在使用');if(before.code!==code)ensure(!(await tenantQuery('SELECT 1 FROM orders WHERE store_id=$1 AND wristband_no=$2 LIMIT 1',[actor.storeId,before.code])).rowCount,409,'WRISTBAND_HISTORY','已有订单引用，不能修改手牌编号')}
  }
  if(table==='items'&&before)ensure((values as any).stock===before.stock,409,'USE_INVENTORY_OPERATION','库存变化请使用入库、出库或盘点，以保留库存流水');
  if(table==='items'&&before)await preserveItemIdentity(before,values as {type:string;unit:string});
  if(table==='items'&&actor.role==='support')ensure((values as any).stock<=0,403,'SUPPORT_ASSETS_FORBIDDEN','支持会话不能录入库存资产');
  const entries=Object.entries(values).filter(([,value])=>value!==undefined),columns=entries.map(([key])=>key),parameters=entries.map(([,value])=>value);
  let row:any;
  if(id)row=(await tenantQuery(`UPDATE ${table} SET ${columns.map((key,i)=>`${key}=$${i+1}`).join(',')} WHERE id=$${columns.length+1} AND store_id=$${columns.length+2} RETURNING *`,[...parameters,id,actor.storeId])).rows[0];
  else row=(await tenantQuery(`INSERT INTO ${table}(store_id,${columns.join(',')}) VALUES($1,${columns.map((_,i)=>'$'+(i+2)).join(',')}) RETURNING *`,[actor.storeId,...parameters])).rows[0];
  if(table==='items'&&!id&&row.stock>0)await tenantQuery("INSERT INTO inventory_movements(store_id,item_id,type,qty,delta,balance_after,source_type,source_id,remark,operator_id) VALUES($1,$2,'opening',$3,$3,$3,'catalog.opening',$5,'期初库存',$4)",[actor.storeId,row.id,row.stock,actor.user.id,String(row.id)]);
  await audit(table+'.saved',{before,after:row},table,row.id);await event(table+'.changed',row.id);return row;
 })));
 catalogRouter.delete(path+'/:id',merchantRoute({write:true,store:true,roles:['manager'],support:'configuration'},async(req,actor)=>{
  if(table==='wristbands')await lockBandConfiguration();
  const id=Id.parse(req.params.id),row=await storeObject(table,id,actor.storeId!,true);
  if(table==='rooms')ensure(row.status==='idle',409,'ROOM_BUSY','房间仍在营业或预约中');
  if(table==='technicians')ensure(row.status!=='serving',409,'TECHNICIAN_BUSY','技师仍在服务中');
  if(table==='wristbands'){
   ensure(row.status==='idle',409,'WRISTBAND_BUSY','手牌仍在使用，不能删除');
   ensure(!(await tenantQuery("SELECT 1 FROM orders WHERE store_id=$1 AND status IN ('open','suspended') AND (wristband_no=$2 OR room_id=$3) LIMIT 1",[actor.storeId,row.code,row.room_id])).rowCount,409,'WRISTBAND_BUSY','手牌或绑定房间仍有未结账、挂单记录，不能删除');
  }
  if(softDelete.has(table))await tenantQuery(`UPDATE ${table} SET active=0 WHERE id=$1 AND store_id=$2`,[id,actor.storeId]);
  else await tenantQuery(`DELETE FROM ${table} WHERE id=$1 AND store_id=$2`,[id,actor.storeId]);
  await audit(table+(table==='wristbands'?'.deleted':'.archived'),{},table,id);await event(table+'.changed',id);return table==='wristbands'?{id,deleted:true}:{id,archived:true};
 }));
}
catalogRouter.post('/rooms/:id/status',merchantRoute({write:true,store:true,roles:['manager','floor'],support:'configuration'},async(req,actor)=>{
 const id=Id.parse(req.params.id),body=z.object({status:z.enum(['idle','cleaning','reserved','maintenance'])}).strict().parse(input(req));await storeObject('rooms',id,actor.storeId!,true);
 ensure(!(await tenantQuery("SELECT 1 FROM orders WHERE room_id=$1 AND store_id=$2 AND status IN('open','suspended')",[id,actor.storeId])).rowCount,409,'ROOM_BUSY','房间仍有关联营业或挂单');
 const room=(await tenantQuery('UPDATE rooms SET status=$1 WHERE id=$2 AND store_id=$3 RETURNING *',[body.status,id,actor.storeId])).rows[0];await audit('room.status',body,'room',id);await event('rooms.changed',id);return room;
}));
catalogRouter.post('/technicians/:id/skills',merchantRoute({write:true,store:true,roles:['manager'],support:'configuration'},async(req,actor)=>{
 const id=Id.parse(req.params.id),body=z.object({item_ids:z.array(Id).max(200)}).strict().parse(input(req));await storeObject('technicians',id,actor.storeId!,true);
 for(const itemId of body.item_ids){const item=await storeObject('items',itemId,actor.storeId!);ensure(item.type==='service',400,'INVALID_SKILL','技师技能必须关联服务项目')}
 await tenantQuery('DELETE FROM technician_skills WHERE technician_id=$1 AND store_id=$2',[id,actor.storeId]);
 for(const itemId of new Set(body.item_ids))await tenantQuery('INSERT INTO technician_skills(store_id,technician_id,item_id) VALUES($1,$2,$3)',[actor.storeId,id,itemId]);
 await audit('technician.skills',body,'technician',id);await event('technicians.changed',id);return {id,item_ids:body.item_ids};
}));
catalogRouter.get('/technician-skills',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(_req,actor)=>{
 const rows=(await tenantQuery('SELECT technician_id,item_id FROM technician_skills WHERE store_id=$1',[actor.storeId])).rows;const result:Record<string,number[]>={};for(const row of rows)(result[row.technician_id]??=[]).push(row.item_id);return result;
}));
