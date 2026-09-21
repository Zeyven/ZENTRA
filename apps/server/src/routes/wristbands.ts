import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,PositiveMoney,input,storeObject,idempotent} from '../business.js';
import {ensure} from '../errors.js';
import {lockBandConfiguration} from '../services/wristbands.js';
export const wristbandsRouter=Router();
wristbandsRouter.post('/wristbands/batch',merchantRoute({write:true,store:true,roles:['manager'],support:'configuration'},async(req,actor)=>idempotent(req,'wristbands.batch',async()=>{
 const body=z.object({codes:z.array(z.string().trim().min(1).max(100)).min(1).max(500)}).strict().parse(input(req));
 const codes=[...new Set(body.codes)];await lockBandConfiguration();
 const existing=(await tenantQuery('SELECT * FROM wristbands WHERE store_id=$1 AND (code=ANY($2::text[]) OR card_uid=ANY($2::text[])) FOR UPDATE',[actor.storeId,codes])).rows;
 for(const code of codes){
  const band=existing.find(r=>r.code===code);
  ensure(!band||band.active===1,409,'WRISTBAND_ARCHIVED',`手牌 ${code} 已停用，请先删除下方旧档案，再重新添加`);
  ensure(!existing.some(r=>r.card_uid===code&&r.code!==code),409,'CARD_CONFLICT',`手牌编号 ${code} 与已有芯片卡号冲突，本批未添加`);
 }
 const added=[];const skipped=codes.filter(code=>existing.some(r=>r.code===code));
 for(const code of codes.filter(code=>!skipped.includes(code)))added.push((await tenantQuery('INSERT INTO wristbands(store_id,code) VALUES($1,$2) RETURNING *',[actor.storeId,code])).rows[0]);
 await audit('wristbands.batch',{added:added.map(r=>r.code),skipped},'wristbands');await event('wristbands.changed',actor.storeId!);return {added:added.length,skipped:skipped.length};
})));
wristbandsRouter.get('/wristbands/resolve',merchantRoute({store:true,roles:['manager','floor'],support:'read'},async(req,actor)=>{
 const card=z.string().trim().min(1).max(128).parse(req.query.card);
 const rows=(await tenantQuery('SELECT * FROM wristbands WHERE store_id=$1 AND active=1 AND (code=$2 OR card_uid=$2)',[actor.storeId,card])).rows;
 ensure(rows.length,404,'CARD_NOT_FOUND','未登记的手牌或芯片卡号');ensure(rows.length===1,409,'CARD_AMBIGUOUS','卡号存在歧义，请核对配置');
 const band=rows[0];ensure(band.room_id,409,'CARD_UNBOUND','手牌尚未固定绑定房间');
 const room=await storeObject('rooms',band.room_id,actor.storeId!);ensure(room.active===1,409,'ROOM_INACTIVE','绑定房间已停用');
 const order=(await tenantQuery("SELECT id FROM orders WHERE room_id=$1 AND status IN ('open','suspended')",[room.id])).rows[0];
 return {code:band.code,room_id:room.id,room_no:room.room_no,room_name:room.room_name,status:room.status,order_id:order?.id??null};
}));
wristbandsRouter.post('/wristbands/:id/binding',merchantRoute({write:true,store:true,roles:['manager'],support:'configuration'},async(req,actor)=>idempotent(req,'wristbands.binding:'+req.params.id,async()=>{
 const id=Id.parse(req.params.id),b=z.object({room_id:Id.nullable(),card_uid:z.string().trim().min(1).max(128).nullable(),reason:z.string().trim().min(1).max(500)}).strict().parse(input(req));
 await lockBandConfiguration();const before=await storeObject('wristbands',id,actor.storeId!);
 // Cashier operations lock rooms before wristbands; keep the same lock order.
 for(const roomId of [...new Set([before.room_id,b.room_id].filter(Boolean))].sort((a,b)=>a-b)){
  const room=await storeObject('rooms',roomId,actor.storeId!,true);
  if(roomId===b.room_id)ensure(room.active===1&&room.status==='idle',409,'ROOM_BUSY','目标房间必须空闲且有效');
 }
 const band=await storeObject('wristbands',id,actor.storeId!,true);ensure(band.active===1&&band.status==='idle',409,'WRISTBAND_BUSY','手牌仍在使用或已停用');
 ensure(!(await tenantQuery("SELECT 1 FROM orders WHERE store_id=$1 AND status IN ('open','suspended') AND (wristband_no=$2 OR room_id=$3 OR room_id=$4)",[actor.storeId,band.code,band.room_id,b.room_id])).rowCount,409,'ROOM_BUSY','原房间或目标房间仍有关联营业或挂单');
 if(b.card_uid)ensure(!(await tenantQuery('SELECT 1 FROM wristbands WHERE store_id=$1 AND id<>$2 AND (code=$3 OR card_uid=$3)',[actor.storeId,id,b.card_uid])).rowCount,409,'CARD_CONFLICT','芯片卡号已用于其他手牌');
 const row=(await tenantQuery('UPDATE wristbands SET room_id=$1,card_uid=$2 WHERE id=$3 RETURNING *',[b.room_id,b.card_uid,id])).rows[0];await audit('wristband.binding',{before:{room_id:band.room_id,card_uid:band.card_uid},...b},'wristband',id);await event('wristbands.changed',id);return row;
})));
wristbandsRouter.post('/wristbands/:id/deposit',merchantRoute({write:true,store:true,roles:['manager'],support:'configuration'},async(req,actor)=>idempotent(req,'wristbands.deposit:'+req.params.id,async()=>{
 const id=Id.parse(req.params.id),b=z.object({deposit:PositiveMoney}).strict().parse(input(req));const band=await storeObject('wristbands',id,actor.storeId!,true);
 ensure(band.active===1&&band.status==='idle',409,'WRISTBAND_BUSY','请在手牌空闲时调整默认押金');
 const row=(await tenantQuery('UPDATE wristbands SET deposit=$1 WHERE id=$2 RETURNING *',[b.deposit,id])).rows[0];await audit('wristband.deposit',{before:band.deposit,after:b.deposit},'wristband',id);await event('wristbands.changed',id);return row;
})));
