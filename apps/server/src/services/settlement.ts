import {Decimal} from 'decimal.js';
import {context,tenantQuery} from '../db/pools.js';
import {ensure} from '../errors.js';
import {money,sum} from '../business.js';
// Allocate integer cents with the largest remainder method; allocated discounts sum exactly to the order discount.
export function allocateDiscount(amounts:number[],discount:number){
 const total=sum(amounts),cents=new Decimal(discount).mul(100);if(!total.gt(0))return amounts.map(()=>0);
 const values=amounts.map((amount,index)=>{const exact=cents.mul(amount).div(total);return {index,cents:exact.floor(),fraction:exact.minus(exact.floor())}});
 let remaining=cents.minus(sum(values.map(v=>v.cents))).toNumber();
 for(const value of [...values].sort((a,b)=>b.fraction.comparedTo(a.fraction)||a.index-b.index)){if(remaining<=0)break;value.cents=value.cents.plus(1);remaining--}
 ensure(remaining===0,500,'ALLOCATION_FAILED','优惠分配未能完成');return values.map(v=>v.cents.div(100).toNumber());
}
export async function snapshotSettlement(entryId:number,orderId:number){
 const order=(await tenantQuery('SELECT subtotal,discount FROM orders WHERE id=$1 AND store_id=$2',[orderId,context().storeId])).rows[0];
 const lines=(await tenantQuery(`SELECT oi.*,coalesce(i.commission,0) AS unit_commission,coalesce(i.cost,0) AS unit_cost,
 coalesce((SELECT sum(sc.qty*p.cost) FROM service_consumables sc JOIN items p ON p.merchant_id=sc.merchant_id AND p.id=sc.product_item_id WHERE sc.service_item_id=oi.item_id AND sc.store_id=oi.store_id),0) AS unit_material
 FROM order_items oi LEFT JOIN items i ON i.merchant_id=oi.merchant_id AND i.id=oi.item_id WHERE oi.order_id=$1 AND oi.store_id=$2 AND oi.is_refund=0 ORDER BY oi.id`,[orderId,context().storeId])).rows;
 const amounts=lines.map(i=>i.is_gift?0:i.amount);ensure(sum(amounts).equals(order.subtotal),409,'SUBTOTAL_MISMATCH','项目合计与订单折前金额不一致');
 const discounts=allocateDiscount(amounts,order.discount);
 for(const [index,line] of lines.entries())await tenantQuery(`INSERT INTO settlement_lines(store_id,entry_id,order_item_id,item_id,item_name,item_type,quantity,gross_amount,discount_amount,standard_commission,standard_material)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[context().storeId,entryId,line.id,line.item_id,line.item_name,line.item_type,line.quantity,amounts[index],discounts[index],line.item_type==='service'?money(new Decimal(line.unit_commission).mul(line.quantity)):0,money(new Decimal(line.item_type==='service'?line.unit_material:line.unit_cost).mul(line.quantity))]);
}
export async function reverseSettlement(entryId:number,reversalOf:number){
 await tenantQuery(`INSERT INTO settlement_lines(store_id,entry_id,order_item_id,item_id,item_name,item_type,quantity,gross_amount,discount_amount,standard_commission,standard_material)
 SELECT store_id,$1,order_item_id,item_id,item_name,item_type,-quantity,-gross_amount,-discount_amount,-standard_commission,-standard_material FROM settlement_lines WHERE entry_id=$2 AND store_id=$3`,[entryId,reversalOf,context().storeId]);
}
