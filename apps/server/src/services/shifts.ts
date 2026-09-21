import {Decimal} from 'decimal.js';
import {context,tenantQuery} from '../db/pools.js';
import {event} from '../access.js';
import {ensure} from '../errors.js';
import {snapshotSettlement,reverseSettlement} from './settlement.js';
export async function lockStoreShift(){const c=context();await tenantQuery('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`shift:${c.merchantId}:${c.storeId}`])}
export async function postingShift(){await lockStoreShift();return (await tenantQuery("SELECT * FROM shifts WHERE store_id=$1 AND status='open' FOR UPDATE",[context().storeId])).rows[0]??null}
export interface Entry{kind:string;method?:string;amount:number;orderId?:number;operationId?:number;paymentId?:number;reversalOf?:number;reason:string}
export async function postEntry(shift:any,entry:Entry){
 ensure(Number.isFinite(entry.amount)&&new Decimal(entry.amount).decimalPlaces()<=2,400,'INVALID_AMOUNT','金额精度无效');
 const c=context(),row=(await tenantQuery(`INSERT INTO shift_entries(store_id,shift_id,cashier_id,kind,method,amount,order_id,asset_operation_id,payment_id,reversal_of,reason)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[c.storeId,shift?.id??null,c.userId,entry.kind,entry.method??null,entry.amount,entry.orderId??null,entry.operationId??null,entry.paymentId??null,entry.reversalOf??null,entry.reason])).rows[0];
 if(entry.kind==='sale')await snapshotSettlement(row.id,entry.orderId!);
 if(entry.kind==='sale_reversal')await reverseSettlement(row.id,entry.reversalOf!);
 await event('shift.changed',shift?.id);return row;
}
const methodFields:Record<string,string>={'现金':'total_cash','微信':'total_wechat','支付宝':'total_alipay','银行卡':'total_card','美团':'total_meituan','抖音':'total_douyin','会员卡':'total_member'};
export async function shiftSummary(shift:any){
 const entries=(await tenantQuery('SELECT kind,method,sum(amount) AS amount FROM shift_entries WHERE store_id=$1 AND shift_id=$2 GROUP BY kind,method',[shift.store_id,shift.id])).rows;
 const totals:Record<string,number>={total_sales:0,total_discount:0,total_cash:0,total_wechat:0,total_alipay:0,total_card:0,total_meituan:0,total_douyin:0,total_member:0,total_recharge:0,total_refund:0,deposit_net:0,booking_deposit_net:0};
 const net:Record<string,number>={};const add=(key:string,amount:number)=>totals[key]=new Decimal(totals[key]??0).plus(amount).toNumber();
 for(const e of entries){
  if(['sale','sale_reversal'].includes(e.kind))add('total_sales',e.amount);
  if(['discount','discount_reversal'].includes(e.kind))add('total_discount',e.amount);
  if(['payment','payment_reversal'].includes(e.kind)&&methodFields[e.method])add(methodFields[e.method],e.amount);
  if(e.kind==='payment_reversal')add('total_refund',-e.amount);
  if(['recharge','recharge_reversal'].includes(e.kind))add('total_recharge',e.amount);
  if(['deposit','deposit_refund'].includes(e.kind))add('deposit_net',e.amount);
  if(['booking_deposit','booking_refund'].includes(e.kind))add('booking_deposit_net',e.amount);
  if(e.method&&e.method!=='会员卡')net[e.method]=new Decimal(net[e.method]??0).plus(e.amount).toNumber();
 }
 return {...shift,...totals,net_external:net,expected_cash:new Decimal(shift.start_cash).plus(net['现金']??0).toNumber()};
}
export async function reverseOrderEntries(shift:any,orderId:number,paymentIds:number[],reason:string){
 const entries=(await tenantQuery("SELECT e.* FROM shift_entries e WHERE e.order_id=$1 AND e.store_id=$2 AND (e.payment_id=ANY($3::bigint[]) OR e.kind IN('sale','discount')) AND NOT EXISTS(SELECT 1 FROM shift_entries r WHERE r.reversal_of=e.id) ORDER BY e.id",[orderId,context().storeId,paymentIds])).rows;
 for(const e of entries)await postEntry(shift,{kind:e.kind+'_reversal',method:e.method??undefined,amount:-e.amount,orderId,paymentId:e.payment_id??undefined,reversalOf:e.id,reason});
}
