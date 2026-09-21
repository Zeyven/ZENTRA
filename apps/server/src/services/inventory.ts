import {Decimal} from 'decimal.js';
import {context,tenantQuery} from '../db/pools.js';
import {storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {audit,event} from '../access.js';
export async function preserveItemIdentity(before:{id:number;type:string;unit:string},next:{type:string;unit:string}){
 ensure(next.type===before.type,409,'ITEM_TYPE_LOCKED','已有项目不能更改为其他类型，请新建项目');
 if(next.unit===before.unit)return;
 const linked=(await tenantQuery(`SELECT EXISTS(SELECT 1 FROM inventory_movements WHERE item_id=$1) OR EXISTS(SELECT 1 FROM purchase_order_items WHERE item_id=$1) OR EXISTS(SELECT 1 FROM inventory_transfer_items WHERE item_id=$1 OR target_item_id=$1) AS present`,[before.id])).rows[0].present;
 ensure(!linked,409,'ITEM_UNIT_LOCKED','商品已有库存或采购调拨记录，计量单位不可更改');
}
export async function stockMove(itemId:number,delta:number,reason:string,sourceType:string,sourceId?:string|number,reversalOf?:number,storeId=context().storeId!){
 ensure(Number.isFinite(delta)&&delta!==0&&new Decimal(delta).decimalPlaces()<=3,400,'INVALID_QUANTITY','库存数量无效');
 const item=await storeObject('items',itemId,storeId,true);ensure(item.type==='product',400,'NOT_PRODUCT','库存操作仅适用于商品和耗材');
 if(item.stock===-1)return null;
 const balance=new Decimal(item.stock).plus(delta);ensure(balance.gte(0),409,'INSUFFICIENT_STOCK',`「${item.name}」库存不足`);
 await tenantQuery('UPDATE items SET stock=$1 WHERE id=$2',[balance.toString(),item.id]);
 const movement=(await tenantQuery(`INSERT INTO inventory_movements(store_id,item_id,type,qty,delta,balance_after,remark,operator_id,source_type,source_id,reversal_of,unit_cost)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[storeId,itemId,delta>0?'in':'out',Math.abs(delta),delta,balance.toString(),reason,context().userId,sourceType,sourceId===undefined?null:String(sourceId),reversalOf??null,item.cost])).rows[0];
 await audit('inventory.moved',{movement_id:movement.id,delta,balance_after:balance.toNumber()},'item',itemId);await event('inventory.changed',itemId,storeId);return movement;
}
export async function reverseStock(movementId:number,reason:string){
 const movement=await storeObject('inventory_movements',movementId,context().storeId!);
 ensure(!(await tenantQuery('SELECT 1 FROM inventory_movements WHERE reversal_of=$1',[movementId])).rowCount,409,'STOCK_ALREADY_REVERSED','库存流水已冲回');
 return stockMove(movement.item_id,-movement.delta,reason,'reversal',movement.source_id,movement.id);
}
export async function consumeMaterials(orderId:number){
 const rows=(await tenantQuery(`SELECT sc.product_item_id AS item_id,sum(sc.qty*oi.quantity) AS qty FROM order_items oi
 JOIN service_consumables sc ON sc.merchant_id=oi.merchant_id AND sc.store_id=oi.store_id AND sc.service_item_id=oi.item_id
 WHERE oi.order_id=$1 AND oi.is_refund=0 AND oi.item_type='service' GROUP BY sc.product_item_id ORDER BY sc.product_item_id`,[orderId])).rows;
 const movements:number[]=[];for(const row of rows){const moved=await stockMove(row.item_id,-row.qty,'服务耗材','checkout',orderId);if(moved)movements.push(moved.id)}return movements;
}
