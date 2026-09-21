import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {Decimal} from 'decimal.js';
import {PurchaseCreate,PurchaseReceipt,PurchaseCancel,TransferCreate,defaultActions,defaultPages} from '@za-spa/contracts';
import {merchantRoute,audit,event,type Actor} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,input,idempotent,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {stockMove} from '../services/inventory.js';
import type {Request} from 'express';

export const supplyRouter=Router();
const read={store:true,roles:['manager'],support:'read' as const};
const write={write:true,store:true,roles:['manager'],action:'adjust'};
const pageSize=50;
const cursor=(value:unknown)=>value===undefined?null:Id.parse(value);
function page(rows:any[]){return {items:rows.slice(0,pageSize),next_cursor:rows.length>pageSize?rows[pageSize-1].id:null}}
async function purchaseDetail(order:any){
 const supplier=order.supplier_id?(await tenantQuery('SELECT name FROM suppliers WHERE id=$1',[order.supplier_id])).rows[0]:null;
 const items=(await tenantQuery('SELECT p.*,i.name AS item_name,i.unit FROM purchase_order_items p JOIN items i ON i.merchant_id=p.merchant_id AND i.id=p.item_id WHERE p.purchase_order_id=$1 ORDER BY p.id',[order.id])).rows;
 return {...order,supplier_name:supplier?.name??null,items};
}
supplyRouter.get('/purchase-orders',merchantRoute(read,async(req,actor)=>page((await tenantQuery('SELECT p.*,s.name AS supplier_name FROM purchase_orders p LEFT JOIN suppliers s ON s.merchant_id=p.merchant_id AND s.id=p.supplier_id WHERE p.store_id=$1 AND ($2::bigint IS NULL OR p.id<$2) ORDER BY p.id DESC LIMIT $3',[actor.storeId,cursor(req.query.before),pageSize+1])).rows)));
supplyRouter.get('/purchase-orders/:id',merchantRoute({...read,snapshot:true},async(req,actor)=>purchaseDetail(await storeObject('purchase_orders',Id.parse(req.params.id),actor.storeId!))));
supplyRouter.post('/purchase-orders',merchantRoute({write:true,store:true,roles:['manager']},async(req,actor)=>idempotent(req,'purchase.create',async()=>{
 const body=PurchaseCreate.parse(input(req));
 if(body.supplier_id){const supplier=await storeObject('suppliers',body.supplier_id,actor.storeId!);ensure(supplier.active===1,409,'SUPPLIER_INACTIVE','供应商已停用')}
 for(const entry of [...body.items].sort((a,b)=>a.item_id-b.item_id)){const item=await storeObject('items',entry.item_id,actor.storeId!,true);ensure(item.type==='product'&&item.stock>=0&&item.active===1,400,'NOT_STOCK_PRODUCT','采购商品必须在用且启用库存管理')}
 const order=(await tenantQuery('INSERT INTO purchase_orders(store_id,order_no,supplier_id,remark,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[actor.storeId,'P'+randomUUID().slice(0,20),body.supplier_id??null,body.remark,actor.user.id])).rows[0];
 for(const entry of body.items)await tenantQuery('INSERT INTO purchase_order_items(store_id,purchase_order_id,item_id,ordered_qty,unit_cost) VALUES($1,$2,$3,$4,$5)',[actor.storeId,order.id,entry.item_id,entry.ordered_qty,entry.unit_cost]);
 await audit('purchase.created',body,'purchase_order',order.id);await event('inventory.changed',order.id);return purchaseDetail(order);
})));
supplyRouter.post('/purchase-orders/:id/receive',merchantRoute(write,async(req,actor)=>idempotent(req,'purchase.receive:'+req.params.id,async()=>{
 const body=PurchaseReceipt.parse(input(req)),order=await storeObject('purchase_orders',Id.parse(req.params.id),actor.storeId!,true);
 ensure(order.status!=='cancelled',409,'PURCHASE_CANCELLED','采购单已取消');
 ensure(order.version===body.version,409,'PURCHASE_CHANGED','采购单已被更新，请刷新明细后核对数量');
 const lines=(await tenantQuery('SELECT * FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY item_id,id FOR UPDATE',[order.id])).rows;
 ensure(body.items.every(i=>lines.some(l=>l.id===i.id)),400,'FOREIGN_PURCHASE_LINE','包含其他采购单的明细');
 for(const line of lines){const entry=body.items.find(i=>i.id===line.id);if(!entry)continue;
  if(body.mode==='receive')ensure(new Decimal(line.received_qty).plus(entry.qty).lte(line.ordered_qty),409,'EXCESS_RECEIPT','收货数量超过采购数量');
  else ensure(new Decimal(line.returned_qty).plus(entry.qty).lte(line.received_qty),409,'EXCESS_RETURN','退货数量超过已收货数量');
  const item=await storeObject('items',line.item_id,actor.storeId!,true);ensure(item.type==='product'&&item.stock>=0,409,'NOT_STOCK_PRODUCT','商品已变更，请核对库存设置');
  await stockMove(line.item_id,body.mode==='receive'?entry.qty:-entry.qty,body.reason,'purchase',order.id);
  await tenantQuery(`UPDATE purchase_order_items SET ${body.mode==='receive'?'received_qty':'returned_qty'}=${body.mode==='receive'?'received_qty':'returned_qty'}+$1 WHERE id=$2`,[entry.qty,line.id]);
 }
 const remaining=(await tenantQuery('SELECT sum(ordered_qty-received_qty) AS qty FROM purchase_order_items WHERE purchase_order_id=$1',[order.id])).rows[0].qty;
 const updated=(await tenantQuery(`UPDATE purchase_orders SET status=$1,version=version+1${body.mode==='receive'?',received_at=now()':''} WHERE id=$2 RETURNING *`,[remaining===0?'received':'partial',order.id])).rows[0];
 await audit('purchase.'+body.mode,body,'purchase_order',order.id);await event('inventory.changed',order.id);return purchaseDetail(updated);
})));
supplyRouter.post('/purchase-orders/:id/cancel',merchantRoute(write,async(req,actor)=>idempotent(req,'purchase.cancel:'+req.params.id,async()=>{
 const body=PurchaseCancel.parse(input(req)),order=await storeObject('purchase_orders',Id.parse(req.params.id),actor.storeId!,true);
 ensure(order.version===body.version,409,'PURCHASE_CHANGED','采购单已被更新，请刷新明细');
 ensure(order.status==='draft',409,'PURCHASE_STATUS','只有尚未收货的采购单可以取消');
 const updated=(await tenantQuery("UPDATE purchase_orders SET status='cancelled',version=version+1,cancelled_at=now(),cancel_reason=$1 WHERE id=$2 RETURNING *",[body.reason,order.id])).rows[0];
 await audit('purchase.cancelled',body,'purchase_order',order.id);await event('inventory.changed',order.id);return purchaseDetail(updated);
})));

// Check the other store without calling authorize(), which would replace the
// transaction's selected-store context and could post stock to the wrong store.
async function permittedStores(actor:Actor,adjust=false){
 if(actor.role==='owner')return actor.stores.filter(s=>!adjust||s.status===1).map(s=>s.id as number);
 if(actor.role==='support')return adjust?[]:actor.stores.map(s=>s.id as number);
 const permissions=(await tenantQuery("SELECT store_id,role,kind,perm_key,enabled FROM role_permissions WHERE (kind='page' AND perm_key='items') OR (kind='action' AND perm_key='adjust')")).rows;
 return actor.stores.filter(s=>{
  if(s.status!==1||s.role!=='manager'||!defaultPages[s.role]?.includes('items')||(s.pages&&!s.pages.includes('items'))||(adjust&&s.actions&&!s.actions.includes('adjust'))||(adjust&&s.operations&&!s.operations.includes('inventoryManage')))return false;
  const rows=permissions.filter(p=>p.store_id===s.id&&p.role===s.role);
  if(rows.find(p=>p.kind==='page')?.enabled===0)return false;
  const action=rows.find(p=>p.kind==='action');return !adjust||(action?action.enabled===1:(s.actions??defaultActions[s.role])?.includes('adjust'));
 }).map(s=>s.id as number);
}
async function requireStores(actor:Actor,ids:number[],adjust=false){
 const allowed=await permittedStores(actor,adjust);
 ensure(ids.every(id=>allowed.includes(id)),403,'TRANSFER_STORE_FORBIDDEN',adjust?'需要两店的项目库存及库存调整授权':'需要两店的项目库存访问授权');
}
async function authorizeTransferWrite(req:Request,actor:Actor){
 // Re-check both grants before looking up a saved idempotent response. A
 // revoked destination grant must also prevent replay of that response.
 if(!req.params.id){const body=TransferCreate.parse(input(req));await requireStores(actor,[body.from_store_id,body.to_store_id],true);return}
 const transfer=(await tenantQuery('SELECT from_store_id,to_store_id FROM inventory_transfers WHERE id=$1',[Id.parse(req.params.id)])).rows[0];
 ensure(transfer,404,'NOT_FOUND','调拨单不存在');await requireStores(actor,[transfer.from_store_id,transfer.to_store_id],true);
}
async function transferDetail(transfer:any){
 const names=(await tenantQuery('SELECT id,name FROM stores WHERE id=ANY($1::bigint[])',[[transfer.from_store_id,transfer.to_store_id]])).rows;
 const items=(await tenantQuery(`SELECT t.*,i.name AS item_name,i.unit,j.name AS target_item_name,j.unit AS target_unit FROM inventory_transfer_items t JOIN items i ON i.merchant_id=t.merchant_id AND i.id=t.item_id JOIN items j ON j.merchant_id=t.merchant_id AND j.id=t.target_item_id WHERE t.transfer_id=$1 ORDER BY t.id`,[transfer.id])).rows;
 return {...transfer,from_store_name:names.find(s=>s.id===transfer.from_store_id)?.name,to_store_name:names.find(s=>s.id===transfer.to_store_id)?.name,items};
}
supplyRouter.get('/inventory-transfers/destinations',merchantRoute(read,async(_req,actor)=>{
 const ids=await permittedStores(actor,true);return actor.stores.filter(s=>s.id!==actor.storeId&&ids.includes(s.id)).map(s=>({id:s.id,name:s.name,code:s.code}));
}));
supplyRouter.get('/inventory-transfers/catalog/:storeId',merchantRoute(read,async(req,actor)=>{
 const target=Id.parse(req.params.storeId);await requireStores(actor,[actor.storeId!,target]);
 return (await tenantQuery("SELECT id,name,unit,stock,cost FROM items WHERE store_id=$1 AND type='product' AND active=1 AND stock>=0 ORDER BY id",[target])).rows;
}));
supplyRouter.get('/inventory-transfers',merchantRoute(read,async(req,actor)=>{
 const allowed=await permittedStores(actor);
 return page((await tenantQuery(`SELECT t.*,s.name AS from_store_name,d.name AS to_store_name FROM inventory_transfers t JOIN stores s ON s.merchant_id=t.merchant_id AND s.id=t.from_store_id JOIN stores d ON d.merchant_id=t.merchant_id AND d.id=t.to_store_id WHERE (t.from_store_id=$1 OR t.to_store_id=$1) AND t.from_store_id=ANY($2::bigint[]) AND t.to_store_id=ANY($2::bigint[]) AND ($3::bigint IS NULL OR t.id<$3) ORDER BY t.id DESC LIMIT $4`,[actor.storeId,allowed,cursor(req.query.before),pageSize+1])).rows);
}));
supplyRouter.get('/inventory-transfers/:id',merchantRoute({...read,snapshot:true},async(req,actor)=>{
 const transfer=(await tenantQuery('SELECT * FROM inventory_transfers WHERE id=$1 AND (from_store_id=$2 OR to_store_id=$2)',[Id.parse(req.params.id),actor.storeId])).rows[0];
 ensure(transfer,404,'NOT_FOUND','调拨单不存在');await requireStores(actor,[transfer.from_store_id,transfer.to_store_id]);return transferDetail(transfer);
}));
supplyRouter.post('/inventory-transfers',merchantRoute(write,async(req,actor)=>{await authorizeTransferWrite(req,actor);return idempotent(req,'inventory.transfer.create',async()=>{
 const body=TransferCreate.parse(input(req));ensure(body.from_store_id===actor.storeId&&body.from_store_id!==body.to_store_id,400,'INVALID_TRANSFER','请选择不同的源门店和目标门店');await requireStores(actor,[body.from_store_id,body.to_store_id],true);
 // Serialize item edits with document creation, always in global item order.
 await tenantQuery('SELECT id FROM items WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',[body.items.flatMap(i=>[i.item_id,i.target_item_id])]);
 for(const line of body.items){const source=await storeObject('items',line.item_id,body.from_store_id),target=await storeObject('items',line.target_item_id,body.to_store_id);ensure(source.type==='product'&&target.type==='product'&&source.active===1&&target.active===1&&source.stock>=0&&target.stock>=0,400,'TRANSFER_PRODUCT','调拨商品必须在用且启用库存管理');ensure(source.unit===target.unit,400,'TRANSFER_UNIT','两店商品单位不同，请先统一单位')}
 const transfer=(await tenantQuery('INSERT INTO inventory_transfers(from_store_id,to_store_id,transfer_no,remark,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[body.from_store_id,body.to_store_id,'T'+randomUUID().slice(0,20),body.remark,actor.user.id])).rows[0];
 for(const line of body.items)await tenantQuery('INSERT INTO inventory_transfer_items(transfer_id,from_store_id,to_store_id,item_id,target_item_id,qty) VALUES($1,$2,$3,$4,$5,$6)',[transfer.id,body.from_store_id,body.to_store_id,line.item_id,line.target_item_id,line.qty]);
 await audit('transfer.created',body,'transfer',transfer.id);await event('inventory.changed',transfer.id,body.from_store_id);await event('inventory.changed',transfer.id,body.to_store_id);return transferDetail(transfer);
})}));
supplyRouter.post('/inventory-transfers/:id/:action',merchantRoute(write,async(req,actor)=>{await authorizeTransferWrite(req,actor);return idempotent(req,'inventory.transfer.'+req.params.action+':'+req.params.id,async()=>{
 const id=Id.parse(req.params.id),action=z.enum(['dispatch','receive','cancel']).parse(req.params.action);z.object({}).strict().parse(input(req));
 const transfer=(await tenantQuery('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE',[id])).rows[0];ensure(transfer,404,'NOT_FOUND','调拨单不存在');await requireStores(actor,[transfer.from_store_id,transfer.to_store_id],true);
 ensure(actor.storeId===(action==='receive'?transfer.to_store_id:transfer.from_store_id),403,'TRANSFER_STORE_FORBIDDEN','请切换至此次操作对应的门店');
 ensure(transfer.status===(action==='receive'?'dispatched':'draft'),409,'TRANSFER_STATUS','调拨单状态已变化，请刷新明细');
 const lines=(await tenantQuery(`SELECT * FROM inventory_transfer_items WHERE transfer_id=$1 ORDER BY ${action==='receive'?'target_item_id,item_id':'item_id,target_item_id'}`,[id])).rows;
 if(action!=='cancel')for(const line of lines){
  const itemId=action==='receive'?line.target_item_id:line.item_id,item=await storeObject('items',itemId,actor.storeId!,true);
  ensure(item.type==='product'&&item.stock>=0,409,'TRANSFER_PRODUCT','商品已变更，请核对库存设置');
  await stockMove(itemId,action==='receive'?line.qty:-line.qty,'门店调拨','transfer',id);
 }
 const status=action==='receive'?'received':action==='dispatch'?'dispatched':'cancelled';const result=(await tenantQuery(`UPDATE inventory_transfers SET status=$1${action==='receive'?',received_at=now()':action==='dispatch'?',dispatched_at=now()':''} WHERE id=$2 RETURNING *`,[status,id])).rows[0];
 await audit('transfer.'+action,{from_store_id:transfer.from_store_id,to_store_id:transfer.to_store_id},'transfer',id);await event('inventory.changed',id,transfer.from_store_id);await event('inventory.changed',id,transfer.to_store_id);return transferDetail(result);
})}));
