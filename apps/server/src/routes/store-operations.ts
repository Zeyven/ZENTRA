import {gatewayReadiness} from '@za-spa/contracts';
import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,input,idempotent,storeObject} from '../business.js';
import {ensure} from '../errors.js';
export const storeOperationsRouter=Router();
const read={store:true,roles:['manager','floor'],support:'read' as const},write={store:true,write:true,roles:['manager','floor']};
storeOperationsRouter.get('/wine-storage',merchantRoute(read,async(_req,actor)=>(await tenantQuery("SELECT * FROM wine_storage WHERE store_id=$1 AND status='stored' ORDER BY id DESC LIMIT 500",[actor.storeId])).rows));
storeOperationsRouter.post('/wine-storage',merchantRoute(write,async(req,actor)=>idempotent(req,'wine-storage.save',async()=>{
 const b=z.object({customer_name:z.string().trim().min(1).max(100),phone:z.string().max(40).default(''),item_name:z.string().trim().min(1).max(200),quantity:z.number().int().min(1).max(1000000),remark:z.string().max(1000).default('')}).strict().parse(input(req));
 const row=(await tenantQuery('INSERT INTO wine_storage(store_id,customer_name,phone,item_name,quantity,remark) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[actor.storeId,b.customer_name,b.phone,b.item_name,b.quantity,b.remark])).rows[0];await audit('wine.stored',b,'wine_storage',row.id);await event('wine.changed',row.id);return row;
})));
storeOperationsRouter.delete('/wine-storage/:id',merchantRoute(write,async(req,actor)=>idempotent(req,'wine-storage.collect:'+req.params.id,async()=>{
 const row=await storeObject('wine_storage',Id.parse(req.params.id),actor.storeId!,true);ensure(row.status==='stored',409,'WINE_COLLECTED','寄存物品已领取');await tenantQuery("UPDATE wine_storage SET status='collected' WHERE id=$1",[row.id]);await audit('wine.collected',{quantity:row.quantity},'wine_storage',row.id);await event('wine.changed',row.id);return {id:row.id,collected:true};
})));
storeOperationsRouter.get('/alerts',merchantRoute({store:true,roles:['manager'],support:'read'},async(_req,actor)=>{
 const list:any[]=[];const allowed=(page:string)=>actor.role==='owner'||actor.role==='support'||actor.pages.includes(page);
 if(allowed('items'))for(const item of (await tenantQuery("SELECT id,name,stock,unit,low_stock_threshold FROM items WHERE store_id=$1 AND active=1 AND type='product' AND stock>=0 AND stock<=low_stock_threshold",[actor.storeId])).rows)list.push({type:'low_stock',severity:item.stock===0?'high':'warning',target_id:item.id,title:`库存预警：${item.name}`,detail:`剩余 ${item.stock} ${item.unit}，预警线 ${item.low_stock_threshold}`});
 if(allowed('orders'))for(const row of (await tenantQuery("SELECT id,order_no,opened_at FROM orders WHERE store_id=$1 AND status IN('open','suspended') AND opened_at<now()-interval '24 hours'",[actor.storeId])).rows)list.push({type:'long_order',severity:'warning',target_id:row.id,title:`长时间未结账：${row.order_no}`,detail:'账单已超过 24 小时，请核对顾客和房态'});
 if(allowed('approvals'))for(const row of (await tenantQuery("SELECT id,action_type FROM approval_requests WHERE store_id=$1 AND status='pending' AND requested_at<now()-interval '24 hours'",[actor.storeId])).rows)list.push({type:'approval_overdue',severity:'warning',target_id:row.id,title:`审批待处理：#${row.id}`,detail:'申请已超过 24 小时，请核对是否仍需执行'});
 const reversals=(await tenantQuery("SELECT count(*) AS count FROM audit_events WHERE store_id=$1 AND action='order.reverse_checkout' AND created_at::date=current_date",[actor.storeId])).rows[0].count;if(allowed('orders')&&reversals>=3)list.push({type:'frequent_reversals',severity:'high',title:'今日反结账较多',detail:`今日已执行 ${reversals} 次反结账，请核对原因与原收款记录`});
 if(allowed('settings'))for(const gateway of (await tenantQuery('SELECT id,name,expires_at,last_seen_at,revoked_at FROM hardware_gateways WHERE store_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 100',[actor.storeId])).rows){const state=gatewayReadiness(gateway);if(!state.fresh)list.push({type:'gateway_attention',severity:'warning',target_id:gateway.id,title:'设备网关：'+gateway.name,detail:state.label+'；请到设备接口核对授权和连接，不代表实体设备已经故障'});}
 if(allowed('shift'))for(const shift of (await tenantQuery("SELECT id,summary_json FROM shifts WHERE store_id=$1 AND status='closed' AND end_at>=now()-interval '7 days' AND coalesce((summary_json->>'cash_difference')::numeric,0)<>0 ORDER BY id DESC LIMIT 10",[actor.storeId])).rows)list.push({type:'cash_difference',severity:'warning',target_id:shift.id,title:'近期现金差异：班次 #'+shift.id,detail:'实点与应交差额 '+shift.summary_json.cash_difference+' 元；历史盘点记录，请核对交班说明'});
 return {list,summary:{total:list.length,high:list.filter(x=>x.severity==='high').length,warning:list.filter(x=>x.severity==='warning').length}};
}));
