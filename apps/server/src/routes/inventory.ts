import {Router} from 'express';
import {z} from 'zod';
import {supplyRouter} from './supply.js';
import {Decimal} from 'decimal.js';
import {merchantRoute,audit,event} from '../access.js';
import {context,tenantQuery} from '../db/pools.js';
import {Id,input,idempotent,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {stockMove,reverseStock} from '../services/inventory.js';
import {approvalGate,approvalPhase} from '../services/approvals.js';
export const inventoryRouter=Router();
const read={store:true,roles:['manager'],support:'read' as const};const write={write:true,store:true,roles:['manager'],action:'adjust'};
const quantity=z.number().finite().positive().max(1000000000).refine(v=>new Decimal(v).decimalPlaces()<=3,'数量最多三位小数');
const note=z.string().trim().min(1).max(500);
inventoryRouter.get('/inventory',merchantRoute(read,async(req,actor)=>{
 const id=req.query.item_id?Id.parse(req.query.item_id):null;
 return (await tenantQuery("SELECT mv.*,CASE WHEN mv.source_type='loss' THEN 'loss' ELSE mv.type END AS type,i.name AS item_name FROM inventory_movements mv JOIN items i ON i.merchant_id=mv.merchant_id AND i.id=mv.item_id WHERE mv.store_id=$1 AND ($2::bigint IS NULL OR mv.item_id=$2) ORDER BY mv.id DESC LIMIT 300",[actor.storeId,id])).rows;
}));
inventoryRouter.get('/inventory/overview',merchantRoute(read,async(_req,actor)=>{
 const items=(await tenantQuery("SELECT * FROM items WHERE store_id=$1 AND type='product' AND active=1 AND stock>=0 ORDER BY id",[actor.storeId])).rows;
 const loss=(await tenantQuery("SELECT coalesce(sum(qty),0) AS loss_qty_today,coalesce(sum(qty*unit_cost),0) AS loss_cost_today FROM inventory_movements WHERE store_id=$1 AND source_type='loss' AND created_at::date=current_date",[actor.storeId])).rows[0],low=items.filter(i=>i.stock<=i.low_stock_threshold);
 return {items,low_stock:low,stock_value:items.reduce((total,i)=>total.plus(new Decimal(i.stock).mul(i.cost)),new Decimal(0)).toNumber(),summary:{managed_count:items.length,low_stock_count:low.length,...loss}};
}));
inventoryRouter.post('/inventory/move',merchantRoute(write,async req=>idempotent(req,'inventory.move'+approvalPhase(req),async()=>{
 const body=z.object({item_id:Id,type:z.enum(['in','out','loss']),qty:quantity,remark:note,approval_id:Id.optional()}).strict().parse(input(req));const item=await storeObject('items',body.item_id,context().storeId!,true);ensure(item.stock>=0,409,'STOCK_UNTRACKED','此商品未启用库存计数');
 const {approval_id,...operation}=body;const pending=await approvalGate(req,{action:'inventory_adjustment',targetType:'item',targetId:item.id,reason:body.remark,amount:new Decimal(item.cost).mul(body.qty).toNumber(),before:{id:item.id,stock:item.stock,cost:item.cost},operation,approvalId:approval_id});if(pending)return pending;
 const movement=await stockMove(body.item_id,body.type==='in'?body.qty:-body.qty,body.remark,body.type==='loss'?'loss':'manual');return {movement,item:await storeObject('items',body.item_id,context().storeId!)};
})));
inventoryRouter.post('/inventory/count',merchantRoute(write,async(req,actor)=>idempotent(req,'inventory.count'+approvalPhase(req),async()=>{
 const body=z.object({items:z.array(z.object({item_id:Id,actual_qty:quantity.or(z.literal(0)),expected_stock:z.number().nonnegative()}).strict()).min(1).max(500),remark:note,approval_id:Id.optional()}).strict().parse(input(req));
 ensure(new Set(body.items.map(i=>i.item_id)).size===body.items.length,400,'DUPLICATE_ITEM','盘点商品不能重复');
 const before=[];let adjustment=new Decimal(0);for(const entry of [...body.items].sort((a,b)=>a.item_id-b.item_id)){const item=await storeObject('items',entry.item_id,actor.storeId!,true);ensure(item.stock===entry.expected_stock,409,'STOCK_CHANGED','盘点期间库存已变化，请刷新核对');before.push({id:item.id,stock:item.stock,cost:item.cost});adjustment=adjustment.plus(new Decimal(entry.actual_qty).minus(item.stock).abs().mul(item.cost))}
 const pending=await approvalGate(req,{action:'inventory_adjustment',targetType:'inventory_count',reason:body.remark,amount:adjustment.toNumber(),before,operation:{type:'count',items:body.items,remark:body.remark},approvalId:body.approval_id});if(pending)return pending;
 const stocktake=(await tenantQuery('INSERT INTO inventory_stocktakes(store_id,remark,operator_id) VALUES($1,$2,$3) RETURNING *',[actor.storeId,body.remark,actor.user.id])).rows[0];
 const movements=[];for(const entry of [...body.items].sort((a,b)=>a.item_id-b.item_id)){
  const item=await storeObject('items',entry.item_id,actor.storeId!,true);ensure(item.stock===entry.expected_stock,409,'STOCK_CHANGED','盘点期间库存已变化，请刷新核对');const delta=new Decimal(entry.actual_qty).minus(item.stock).toNumber();if(delta!==0)movements.push(await stockMove(item.id,delta,body.remark,'stocktake',stocktake.id));
 }
 await audit('inventory.counted',{stocktake_id:stocktake.id,items:body.items});return {stocktake,movements};
})));
inventoryRouter.post('/inventory/count/:id/reverse',merchantRoute(write,async(req,actor)=>idempotent(req,'inventory.count.reverse:'+req.params.id,async()=>{
 const body=z.object({reason:note}).strict().parse(input(req)),id=Id.parse(req.params.id);const stocktake=await storeObject('inventory_stocktakes',id,actor.storeId!,true);ensure(!stocktake.cancelled_at,409,'ALREADY_REVERSED','盘点已经冲销');
 const movements=(await tenantQuery("SELECT * FROM inventory_movements WHERE store_id=$1 AND source_type='stocktake' AND source_id=$2 ORDER BY item_id",[actor.storeId,String(id)])).rows;
 for(const movement of movements)await reverseStock(movement.id,body.reason);await tenantQuery('UPDATE inventory_stocktakes SET cancelled_at=now() WHERE id=$1',[id]);await audit('inventory.count.reversed',body,'stocktake',id);return {id,cancelled:true};
})));
inventoryRouter.get('/service-consumables/:serviceId',merchantRoute(read,async(req,actor)=>{
 const id=Id.parse(req.params.serviceId);await storeObject('items',id,actor.storeId!);return (await tenantQuery('SELECT sc.*,i.name AS product_name FROM service_consumables sc JOIN items i ON i.merchant_id=sc.merchant_id AND i.id=sc.product_item_id WHERE sc.service_item_id=$1 ORDER BY sc.id',[id])).rows;
}));
inventoryRouter.put('/service-consumables/:serviceId',merchantRoute({write:true,store:true,roles:['manager'],support:'configuration'},async(req,actor)=>{
 const id=Id.parse(req.params.serviceId),body=z.object({items:z.array(z.object({product_item_id:Id,qty:quantity}).strict()).max(100)}).strict().parse(input(req));const service=await storeObject('items',id,actor.storeId!,true);ensure(service.type==='service',400,'NOT_SERVICE','请选择服务项目');
 ensure(new Set(body.items.map(i=>i.product_item_id)).size===body.items.length,400,'DUPLICATE_ITEM','耗材不能重复');for(const entry of body.items){const product=await storeObject('items',entry.product_item_id,actor.storeId!);ensure(product.type==='product',400,'NOT_PRODUCT','耗材必须为商品')}
 await tenantQuery('DELETE FROM service_consumables WHERE service_item_id=$1',[id]);for(const entry of body.items)await tenantQuery('INSERT INTO service_consumables(store_id,service_item_id,product_item_id,qty) VALUES($1,$2,$3,$4)',[actor.storeId,id,entry.product_item_id,entry.qty]);
 await audit('service.materials.changed',body,'item',id);await event('items.changed',id);return body.items;
}));
inventoryRouter.use(supplyRouter);
