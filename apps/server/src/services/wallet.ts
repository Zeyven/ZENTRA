import {Decimal} from 'decimal.js';
import {context,tenantQuery} from '../db/pools.js';
import {ensure} from '../errors.js';
import {audit,event} from '../access.js';
import {money} from '../business.js';
interface Assets{principal:number;bonus:number;times:number;points:number}
interface Funding{method?:string;shiftId?:number;amount?:number}
const zeros=():Assets=>({principal:0,bonus:0,times:0,points:0});
const kinds=['principal','bonus','times','points'] as const;
export async function lockMember(id:number,active=true){
 const c=context();const row=(await tenantQuery(`SELECT m.* FROM members m JOIN merchants t ON t.id=m.merchant_id
 WHERE m.id=$1 AND (m.store_id=$2 OR t.member_mode='merchant') FOR UPDATE OF m`,[id,c.storeId])).rows[0];
 ensure(row,404,'MEMBER_NOT_FOUND','会员不存在或不可在当前门店使用');
 if(active)ensure(row.status==='active',409,'MEMBER_INACTIVE','会员已冻结或停用');return row;
}
export async function refreshWallet(memberId:number){
 const totals=(await tenantQuery(`SELECT coalesce(sum(principal_remaining),0) AS principal,coalesce(sum(bonus_remaining),0) AS bonus,
 coalesce(sum(times_remaining),0) AS times,coalesce(sum(points_remaining),0) AS points FROM asset_lots WHERE member_id=$1`,[memberId])).rows[0];
 ensure(totals.principal<=999999999999.99&&totals.bonus<=999999999999.99&&totals.times<=1000000000&&totals.points<=1000000000,400,'WALLET_LIMIT','会员权益总额超过账户上限');
 return (await tenantQuery('UPDATE members SET balance=$1,bonus_balance=$2,times_balance=$3,points=$4,asset_version=asset_version+1 WHERE id=$5 RETURNING *',[totals.principal,totals.bonus,totals.times,totals.points,memberId])).rows[0];
}
async function record(memberId:number,type:string,amount:Assets,reason:string,orderId?:number,reversalOf?:number,funding?:Funding){
 const c=context();return (await tenantQuery(`INSERT INTO asset_operations(store_id,member_id,type,principal,bonus,times,points,operator_id,reason,order_id,reversal_of,payment_method,shift_id,funded_amount)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[c.storeId,memberId,type,amount.principal,amount.bonus,amount.times,amount.points,c.userId,reason,orderId??null,reversalOf??null,funding?.method??null,funding?.shiftId??null,funding?.amount??0])).rows[0];
}
async function allocation(memberId:number,operationId:number,lotId:number,assets:Assets){
 await tenantQuery('INSERT INTO asset_allocations(member_id,operation_id,lot_id,principal,bonus,times,points) VALUES($1,$2,$3,$4,$5,$6,$7)',[memberId,operationId,lotId,assets.principal,assets.bonus,assets.times,assets.points]);
}
async function finish(memberId:number,operation:any){
 const member=await refreshWallet(memberId);
 await tenantQuery('INSERT INTO member_transactions(store_id,member_id,type,amount,times,balance_after,remark,order_id,operator_id,asset_operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[context().storeId,memberId,operation.type,operation.principal,operation.times,member.balance,operation.reason,operation.order_id,context().userId,operation.id]);
 await audit('member.assets.'+operation.type,{operation_id:operation.id,principal:operation.principal,bonus:operation.bonus,times:operation.times,points:operation.points},'member',memberId);
 await event('member.changed',memberId,member.scope_store_id??null);return {member,operation};
}
export async function credit(memberId:number,values:Partial<Assets>,reason:string,type='recharge',orderId?:number,funding?:Funding){
 await lockMember(memberId);const assets={...zeros(),...values};
 ensure(kinds.every(k=>Number.isFinite(assets[k])&&assets[k]>=0)&&Number.isSafeInteger(assets.times)&&Number.isSafeInteger(assets.points),400,'INVALID_ASSETS','权益金额或次数无效');
 ensure(kinds.some(k=>assets[k]>0),400,'EMPTY_ASSETS','没有需要增加的权益');
 const operation=await record(memberId,type,assets,reason,orderId,undefined,funding);
 const lot=(await tenantQuery(`INSERT INTO asset_lots(member_id,origin_store_id,operation_id,principal_original,bonus_original,times_original,points_original,principal_remaining,bonus_remaining,times_remaining,points_remaining)
 VALUES($1,$2,$3,$4,$5,$6,$7,$4,$5,$6,$7) RETURNING id`,[memberId,context().storeId,operation.id,assets.principal,assets.bonus,assets.times,assets.points])).rows[0];
 await allocation(memberId,operation.id,lot.id,assets);return finish(memberId,operation);
}
export async function debit(memberId:number,amount:number,reason:string,orderId?:number,times=0,points=0){
 const member=await lockMember(memberId);
 ensure(Number.isFinite(amount)&&amount>=0&&Number.isSafeInteger(times)&&times>=0&&Number.isSafeInteger(points)&&points>=0,400,'INVALID_ASSETS','扣款金额或次数无效');
 const principal=Decimal.min(amount,member.balance).toNumber(),bonus=money(new Decimal(amount).minus(principal));
 ensure(new Decimal(member.bonus_balance).gte(bonus)&&member.times_balance>=times&&member.points>=points,409,'INSUFFICIENT_ASSETS','会员余额、次数或积分不足');
 const needed:Assets={principal,bonus,times,points};
 const operation=await record(memberId,'consume',{principal:-principal,bonus:-bonus,times:-times,points:-points},reason,orderId);
 const lots=(await tenantQuery('SELECT * FROM asset_lots WHERE member_id=$1 ORDER BY id FOR UPDATE',[memberId])).rows;
 // Walk each asset class independently: all principal lots are spent before any bonus lot.
 for(const lot of lots){
  const used=zeros();
  for(const kind of kinds){used[kind]=Decimal.min(needed[kind],lot[kind+'_remaining']).toNumber();needed[kind]=money(new Decimal(needed[kind]).minus(used[kind]))}
  if(!kinds.some(k=>used[k]>0))continue;
  await tenantQuery('UPDATE asset_lots SET principal_remaining=principal_remaining-$1,bonus_remaining=bonus_remaining-$2,times_remaining=times_remaining-$3,points_remaining=points_remaining-$4 WHERE id=$5',[used.principal,used.bonus,used.times,used.points,lot.id]);
  await allocation(memberId,operation.id,lot.id,{principal:-used.principal,bonus:-used.bonus,times:-used.times,points:-used.points});
 }
 ensure(kinds.every(k=>needed[k]===0),409,'ASSET_LEDGER_MISMATCH','账户与资金批次不一致，请联系管理员核对');
 return finish(memberId,operation);
}
export async function reverseAssets(memberId:number,operationId:number,reason:string){
 await lockMember(memberId,false);
 // The member row serializes asset changes; immutable ledger rows need no update lock.
 const original=(await tenantQuery('SELECT * FROM asset_operations WHERE id=$1 AND member_id=$2',[operationId,memberId])).rows[0];
 ensure(original&&original.type!=='reverse',404,'OPERATION_NOT_FOUND','可冲回的原流水不存在');
 ensure(!(await tenantQuery('SELECT 1 FROM asset_operations WHERE reversal_of=$1',[operationId])).rowCount,409,'ALREADY_REVERSED','原流水已冲回');
 const allocations=(await tenantQuery('SELECT a.*,l.principal_remaining,l.bonus_remaining,l.times_remaining,l.points_remaining,l.principal_original,l.bonus_original,l.times_original,l.points_original FROM asset_allocations a JOIN asset_lots l ON l.merchant_id=a.merchant_id AND l.id=a.lot_id WHERE a.operation_id=$1 ORDER BY a.lot_id FOR UPDATE OF l',[operationId])).rows;
 for(const row of allocations)for(const kind of kinds){
  const remaining=new Decimal(row[kind+'_remaining']).minus(row[kind]);
  ensure(remaining.gte(0)&&remaining.lte(row[kind+'_original']),409,'ASSETS_ALREADY_USED','该笔充值权益已消费，不能冲销原充值');
 }
 const reversed=await record(memberId,'reverse',{principal:-original.principal,bonus:-original.bonus,times:-original.times,points:-original.points},reason,undefined,operationId);
 for(const row of allocations){
  await tenantQuery('UPDATE asset_lots SET principal_remaining=principal_remaining-$1,bonus_remaining=bonus_remaining-$2,times_remaining=times_remaining-$3,points_remaining=points_remaining-$4 WHERE id=$5',[row.principal,row.bonus,row.times,row.points,row.lot_id]);
  await allocation(memberId,reversed.id,row.lot_id,{principal:-row.principal,bonus:-row.bonus,times:-row.times,points:-row.points});
 }
 return finish(memberId,reversed);
}
export async function adjustAssets(memberId:number,deltas:Assets,reason:string,type='adjust'){
 const member=await lockMember(memberId,false);const balances={principal:member.balance,bonus:member.bonus_balance,times:member.times_balance,points:member.points};
 ensure(member.status!=='archived',409,'MEMBER_ARCHIVED','会员已归档，不能继续调整权益');
 ensure(kinds.every(k=>Number.isFinite(deltas[k])&&new Decimal(deltas[k]).decimalPlaces()<=(k==='times'||k==='points'?0:2)&&new Decimal(balances[k]).plus(deltas[k]).gte(0)),400,'INVALID_ASSET_ADJUSTMENT','调整后权益不能为负，金额最多两位小数，次数和积分为整数');
 ensure(kinds.some(k=>deltas[k]!==0),400,'EMPTY_ASSETS','请填写需要调整的权益');
 const operation=await record(memberId,type,deltas,reason),needed=Object.fromEntries(kinds.map(k=>[k,Math.max(0,-deltas[k])])) as unknown as Assets;
 for(const lot of (await tenantQuery('SELECT * FROM asset_lots WHERE member_id=$1 ORDER BY id FOR UPDATE',[memberId])).rows){
  const used=zeros();for(const kind of kinds){used[kind]=Decimal.min(needed[kind],lot[kind+'_remaining']).toNumber();needed[kind]=new Decimal(needed[kind]).minus(used[kind]).toNumber()}
  if(!kinds.some(k=>used[k]>0))continue;
  await tenantQuery('UPDATE asset_lots SET principal_remaining=principal_remaining-$1,bonus_remaining=bonus_remaining-$2,times_remaining=times_remaining-$3,points_remaining=points_remaining-$4 WHERE id=$5',[used.principal,used.bonus,used.times,used.points,lot.id]);
  await allocation(memberId,operation.id,lot.id,{principal:-used.principal,bonus:-used.bonus,times:-used.times,points:-used.points});
 }
 ensure(kinds.every(k=>needed[k]===0),409,'ASSET_LEDGER_MISMATCH','账户与资金批次不一致');
 const positive=Object.fromEntries(kinds.map(k=>[k,Math.max(0,deltas[k])])) as unknown as Assets;
 if(kinds.some(k=>positive[k]>0)){
  const lot=(await tenantQuery(`INSERT INTO asset_lots(member_id,origin_store_id,operation_id,principal_original,bonus_original,times_original,points_original,principal_remaining,bonus_remaining,times_remaining,points_remaining) VALUES($1,$2,$3,$4,$5,$6,$7,$4,$5,$6,$7) RETURNING id`,[memberId,context().storeId,operation.id,positive.principal,positive.bonus,positive.times,positive.points])).rows[0];await allocation(memberId,operation.id,lot.id,positive);
 }
 return finish(memberId,operation);
}
