import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {defaultPages,defaultActions} from '@za-spa/contracts';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';

let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,source:any,target:any,staff:any;
const api=(path:string,method='GET',body?:any,store=a.stores[0].id,token=a.token,key?:string)=>h.api(token,store,path,method,body,key);
before(async()=>{
 h=await harness();a=await h.onboard();b=await h.onboard();
 source=succeeded(await api('/items','POST',{name:'采购耗材',type:'product',price:5,cost:2,stock:20,unit:'包'}));
 target=succeeded(await api('/items','POST',{name:'调入耗材',type:'product',price:5,cost:2,stock:0,unit:'包'},a.stores[1].id));
 staff=succeeded(await api('/users','POST',{username:'stock-manager',password,name:'两店库存店长'}));
 succeeded(await api('/users/'+staff.id+'/grants','PUT',{grants:a.stores.map((s:any)=>({store_id:s.id,role:'manager'}))}));
 staff.token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'stock-manager',password})).token;
 for(const s of a.stores)succeeded(await api('/permissions','PUT',{pages:{manager:defaultPages.manager},actions:{manager:[...defaultActions.manager,'adjust']}},s.id));
});
after(async()=>h.stop());
const newPurchase=async(qty=10)=>succeeded(await api('/purchase-orders','POST',{items:[{item_id:source.id,ordered_qty:qty,unit_cost:1.23}],remark:'采购验收'}));
const newTransfer=async(qty=1,token=a.token,key?:string)=>api('/inventory-transfers','POST',{from_store_id:a.stores[0].id,to_store_id:a.stores[1].id,remark:'连锁补货',items:[{item_id:source.id,target_item_id:target.id,qty}]},a.stores[0].id,token,key);
const stock=async()=>succeeded(await api('/inventory/overview')).items.find((i:any)=>i.id===source.id).stock;

test('purchase response contains committed lines; concurrent fresh keys and lost-response retry produce one receipt',async()=>{
 const order=await newPurchase(),before=await stock(),key=randomUUID(),otherKey=randomUUID();assert.equal(order.items.length,1);assert.equal(order.version,1);
 const body={version:order.version,mode:'receive',reason:'分批到货',items:[{id:order.items[0].id,qty:3}]};
 const result=await Promise.all([api('/purchase-orders/'+order.id+'/receive','POST',body,a.stores[0].id,a.token,key),api('/purchase-orders/'+order.id+'/receive','POST',body,a.stores[0].id,a.token,otherKey)]);
 assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);assert.equal(result.find(r=>r.status===409).code,'PURCHASE_CHANGED');
 const current=succeeded(await api('/purchase-orders/'+order.id));assert.equal(current.version,2);assert.equal(current.items[0].received_qty,3);assert.equal(await stock(),before+3);
 const winner=result[0].status===200?result[0]:result[1];assert.equal(winner.data.items[0].received_qty,3);
 assert.deepEqual(succeeded(await api('/purchase-orders/'+order.id+'/receive','POST',body,a.stores[0].id,a.token,result[0].status===200?key:otherKey)),winner.data);
 assert.equal(await stock(),before+3);
 const posted=await inTenant(a.merchant.id,async()=>(await tenantQuery("SELECT count(*)::int AS count FROM inventory_movements WHERE source_type='purchase' AND source_id=$1",[String(order.id)])).rows[0].count);assert.equal(posted,1);
});
test('purchase rejects cross-order lines, over-receipt, over-return and cancels only unreceived drafts',async()=>{
 const order=await newPurchase(2),other=await newPurchase(2),before=await stock();
 const body={version:1,reason:'验收',items:[{id:order.items[0].id,qty:1},{id:other.items[0].id,qty:1}]};
 assert.equal((await api('/purchase-orders/'+order.id+'/receive','POST',body)).code,'FOREIGN_PURCHASE_LINE');assert.equal(await stock(),before);
 assert.equal((await api('/purchase-orders/'+order.id+'/receive','POST',{version:1,reason:'超收',items:[{id:order.items[0].id,qty:3}]})).code,'EXCESS_RECEIPT');
 const receipt=succeeded(await api('/purchase-orders/'+order.id+'/receive','POST',{version:1,reason:'到货',items:[{id:order.items[0].id,qty:2}]}));assert.equal(receipt.status,'received');
 assert.equal((await api('/purchase-orders/'+order.id+'/cancel','POST',{version:2,reason:'已收货不能取消'})).code,'PURCHASE_STATUS');
 assert.equal((await api('/purchase-orders/'+order.id+'/receive','POST',{version:2,mode:'return',reason:'超退',items:[{id:order.items[0].id,qty:3}]})).code,'EXCESS_RETURN');
 const returned=succeeded(await api('/purchase-orders/'+order.id+'/receive','POST',{version:2,mode:'return',reason:'全退',items:[{id:order.items[0].id,qty:2}]}));assert.equal(returned.items[0].returned_qty,2);assert.equal(await stock(),before);
 const cancelled=succeeded(await api('/purchase-orders/'+other.id+'/cancel','POST',{version:1,reason:'重复采购'}));assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.items.length,1);
 assert.equal((await api('/purchase-orders/'+other.id+'/receive','POST',{version:2,reason:'取消后收货',items:[{id:other.items[0].id,qty:1}]})).code,'PURCHASE_CANCELLED');
});
test('invalid duplicated products and quantity precision cannot create purchase or transfer records',async()=>{
 const line={item_id:source.id,ordered_qty:1,unit_cost:2};
 assert.equal((await api('/purchase-orders','POST',{items:[line,line]})).status,400);
 assert.equal((await api('/purchase-orders','POST',{items:[{...line,ordered_qty:1.0001}]})).status,400);
 const transferLine={item_id:source.id,target_item_id:target.id,qty:1};
 assert.equal((await api('/inventory-transfers','POST',{from_store_id:a.stores[0].id,to_store_id:a.stores[1].id,remark:'重复',items:[transferLine,transferLine]})).status,400);
 const alternate=succeeded(await api('/items','POST',{name:'不同单位',type:'product',price:1,stock:0,unit:'箱'},a.stores[1].id));
 assert.equal((await api('/inventory-transfers','POST',{from_store_id:a.stores[0].id,to_store_id:a.stores[1].id,remark:'单位错误',items:[{...transferLine,target_item_id:alternate.id}]})).code,'TRANSFER_UNIT');
 const fractional=await newPurchase(1.001);assert.equal(fractional.items[0].ordered_qty,1.001);
});
test('both store pages and action grants apply to target lookup, transfer creation, mutation AND idempotent replay',async()=>{
 const key=randomUUID(),created=succeeded(await newTransfer(1,staff.token,key));assert.equal(created.items[0].target_item_name,target.name);
 const dispatchKey=randomUUID();succeeded(await api('/inventory-transfers/'+created.id+'/dispatch','POST',{},a.stores[0].id,staff.token,dispatchKey));
 succeeded(await api('/permissions','PUT',{pages:{manager:defaultPages.manager.filter(p=>p!=='items')},actions:{manager:[...defaultActions.manager,'adjust']}},a.stores[1].id));
 assert.deepEqual(succeeded(await api('/inventory-transfers/destinations','GET',undefined,a.stores[0].id,staff.token)),[]);
 assert.equal((await api('/inventory-transfers/catalog/'+a.stores[1].id,'GET',undefined,a.stores[0].id,staff.token)).status,403);
 assert.equal((await api('/inventory-transfers/'+created.id,'GET',undefined,a.stores[0].id,staff.token)).status,403);
 assert.equal((await newTransfer(1,staff.token,key)).status,403);
 assert.equal((await api('/inventory-transfers/'+created.id+'/dispatch','POST',{},a.stores[0].id,staff.token,dispatchKey)).status,403);
 assert.equal(succeeded(await api('/inventory-transfers','GET',undefined,a.stores[0].id,staff.token)).items.some((r:any)=>r.id===created.id),false);
 succeeded(await api('/permissions','PUT',{pages:{manager:defaultPages.manager},actions:{manager:defaultActions.manager}},a.stores[1].id));
 succeeded(await api('/inventory-transfers/'+created.id,'GET',undefined,a.stores[0].id,staff.token));assert.equal((await newTransfer(1,staff.token)).status,403);
 succeeded(await api('/permissions','PUT',{pages:{manager:defaultPages.manager},actions:{manager:[...defaultActions.manager,'adjust']}},a.stores[1].id));
 succeeded(await api('/inventory-transfers/'+created.id+'/receive','POST',{},a.stores[1].id,staff.token));
});
test('tenant IDs never cross purchase lists/details or transfer target catalogs, even with identical request keys',async()=>{
 const otherItem=succeeded(await api('/items','POST',{name:'采购耗材',type:'product',price:5,stock:0,unit:'包'},b.stores[0].id,b.token)),key=randomUUID();
 const left=succeeded(await api('/purchase-orders','POST',{items:[{item_id:source.id,ordered_qty:1,unit_cost:2}]},a.stores[0].id,a.token,key));
 const right=succeeded(await api('/purchase-orders','POST',{items:[{item_id:otherItem.id,ordered_qty:1,unit_cost:2}]},b.stores[0].id,b.token,key));assert.notEqual(left.id,right.id);
 assert.equal((await api('/purchase-orders/'+left.id,'GET',undefined,b.stores[0].id,b.token)).status,404);
 assert.equal((await api('/inventory-transfers/catalog/'+a.stores[1].id,'GET',undefined,b.stores[0].id,b.token)).status,403);
 const list=succeeded(await api('/purchase-orders','GET',undefined,b.stores[0].id,b.token));assert.deepEqual(list.items.map((r:any)=>r.id),[right.id]);
});
test('transfer insufficient stock rolls back all lines and cancellation has no stock impact',async()=>{
 const before=await stock(),short=succeeded(await api('/items','POST',{name:'不足库存',type:'product',price:1,stock:0,unit:'包'})),shortTarget=succeeded(await api('/items','POST',{name:'不足目标',type:'product',price:1,stock:0,unit:'包'},a.stores[1].id));
 const transfer=succeeded(await api('/inventory-transfers','POST',{from_store_id:a.stores[0].id,to_store_id:a.stores[1].id,remark:'整单回滚',items:[{item_id:source.id,target_item_id:target.id,qty:1},{item_id:short.id,target_item_id:shortTarget.id,qty:1}]}));
 assert.equal((await api('/inventory-transfers/'+transfer.id+'/dispatch','POST',{})).code,'INSUFFICIENT_STOCK');assert.equal(await stock(),before);
 const current=succeeded(await api('/inventory-transfers/'+transfer.id));assert.equal(current.status,'draft');
 const cancelled=succeeded(await api('/inventory-transfers/'+transfer.id+'/cancel','POST',{}));assert.equal(cancelled.status,'cancelled');assert.equal(await stock(),before);
 assert.equal((await api('/inventory-transfers/'+transfer.id+'/receive','POST',{},a.stores[1].id)).status,409);
});
test('fractional stock can still edit catalog prices, while linked unit and product type cannot be rewritten',async()=>{
 const item=succeeded(await api('/items','POST',{name:'分数库存',type:'product',price:10,stock:0,unit:'千克'}));
 const order=succeeded(await api('/purchase-orders','POST',{items:[{item_id:item.id,ordered_qty:1.001,unit_cost:2}]}));
 succeeded(await api('/purchase-orders/'+order.id+'/receive','POST',{version:1,reason:'称重入库',items:[{id:order.items[0].id,qty:1.001}]}));
 const updated=succeeded(await api('/items','POST',{id:item.id,name:item.name,type:'product',price:12,stock:1.001,unit:'千克'}));assert.equal(updated.stock,1.001);assert.equal(updated.price,12);
 assert.equal((await api('/items','POST',{id:item.id,name:item.name,type:'product',price:12,stock:1.001,unit:'克'})).code,'ITEM_UNIT_LOCKED');
 assert.equal((await api('/items','POST',{id:item.id,name:item.name,type:'service',price:12,stock:1.001,unit:'千克',duration:60})).code,'ITEM_TYPE_LOCKED');
});
test('template distribution cannot change a unit after a purchase links the product, including a preview made before the purchase',async()=>{
 const template=succeeded(await api('/catalog/templates','POST',{type:'item',payload:{name:'模板单位保护',type:'product',price:5,unit:'包'}}));
 const body={template_id:template.id,version:template.version,store_ids:[a.stores[0].id]};
 const preview=succeeded(await api('/catalog/preview','POST',body));succeeded(await api('/catalog/distribute','POST',{...body,preview_hash:preview.preview_hash}));
 const binding=succeeded(await api('/catalog/distribution?template_id='+template.id))[0];
 const edited=succeeded(await api('/catalog/templates','POST',{id:template.id,version:template.version,type:'item',payload:{...template.payload,unit:'箱'}}));
 const updated={...body,version:edited.version},before=succeeded(await api('/catalog/preview','POST',updated));
 succeeded(await api('/purchase-orders','POST',{items:[{item_id:binding.item_id,ordered_qty:1,unit_cost:2}]}));
 assert.equal((await api('/catalog/distribute','POST',{...updated,preview_hash:before.preview_hash})).code,'ITEM_UNIT_LOCKED');
 assert.equal((await api('/catalog/preview','POST',updated)).code,'ITEM_UNIT_LOCKED');
 const item=succeeded(await api('/items')).find((i:any)=>i.id===binding.item_id);assert.equal(item.unit,'包');assert.equal(item.stock,0);
});
