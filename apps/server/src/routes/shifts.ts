import {Decimal} from 'decimal.js';
import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,input,PositiveMoney,idempotent,money} from '../business.js';
import {postingShift,shiftSummary} from '../services/shifts.js';
import {ensure} from '../errors.js';
export const shiftsRouter=Router();
const read={store:true,roles:['manager','floor'],support:'read' as const},write={store:true,write:true,roles:['manager','floor']};
shiftsRouter.get('/shifts',merchantRoute(read,async(req,actor)=>{
 const current=z.enum(['0','1']).default('0').parse(req.query.current);
 const rows=(await tenantQuery(`SELECT s.*,u.name AS cashier_name FROM shifts s LEFT JOIN merchant_users u ON u.merchant_id=s.merchant_id AND u.id=s.cashier_id
 WHERE s.store_id=$1 AND ($2='0' OR s.status='open') ORDER BY s.id DESC LIMIT 100`,[actor.storeId,current])).rows;
 const result=[];for(const row of rows)result.push(row.status==='closed'?{...row,...row.summary_json}:await shiftSummary(row));return current==='1'?result[0]??null:result;
}));
shiftsRouter.post('/shifts/start',merchantRoute(write,async(req,actor)=>idempotent(req,'shifts.start',async()=>{
 const b=z.object({start_cash:PositiveMoney}).strict().parse(input(req));ensure(!await postingShift(),409,'SHIFT_OPEN','门店已有未交接班次');
 const row=(await tenantQuery("INSERT INTO shifts(store_id,cashier_id,start_at,start_cash) VALUES($1,$2,now(),$3) RETURNING *",[actor.storeId,actor.user.id,b.start_cash])).rows[0];await audit('shift.started',b,'shift',row.id);await event('shift.changed',row.id);return shiftSummary(row);
})));
shiftsRouter.post('/shifts/end',merchantRoute(write,async(req,actor)=>idempotent(req,'shifts.end',async()=>{
 const b=z.object({note:z.string().trim().max(2000).default(''),actual_cash:PositiveMoney.optional(),expected_shift_id:Id.optional(),expected_cash:z.number().finite().optional()}).strict().parse(input(req)),shift=await postingShift();ensure(shift,409,'NO_OPEN_SHIFT','当前没有进行中的班次');
 const summary=await shiftSummary(shift),fields=['total_sales','total_discount','total_cash','total_wechat','total_alipay','total_card','total_meituan','total_douyin','total_member','total_recharge','total_refund'];
 if(b.actual_cash!==undefined){ensure(b.expected_shift_id===shift.id&&b.expected_cash!==undefined&&new Decimal(summary.expected_cash).equals(b.expected_cash),409,'SHIFT_CHANGED','班次资金已变化，请刷新后重新核对实点现金');ensure(new Decimal(b.actual_cash).equals(summary.expected_cash)||b.note.length>=2,400,'DIFFERENCE_REASON_REQUIRED','实点现金与应交现金不一致，请填写差异原因');}
 const counted=b.actual_cash===undefined?{actual_cash:null,cash_difference:null}:{actual_cash:b.actual_cash,cash_difference:money(new Decimal(b.actual_cash).minus(summary.expected_cash))};
 const snapshot={...counted,...Object.fromEntries([...fields,'deposit_net','booking_deposit_net','net_external','expected_cash'].map(k=>[k,summary[k]]))};
 const row=(await tenantQuery(`UPDATE shifts SET status='closed',end_at=now(),handover_note=$1,closed_by=$2,summary_json=$3,${fields.map((f,i)=>`${f}=$${i+4}`).join(',')} WHERE id=$${fields.length+4} RETURNING *`,[b.note,actor.user.id,JSON.stringify(snapshot),...fields.map(f=>summary[f]),shift.id])).rows[0];
 await audit('shift.closed',{...b,summary:snapshot},'shift',row.id);await event('shift.changed',row.id);return {...row,...snapshot};
})));
