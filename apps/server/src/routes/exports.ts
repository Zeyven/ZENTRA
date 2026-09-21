import {Router,type Response} from 'express';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {z} from 'zod';
import {authorize,bearer,audit} from '../access.js';
import {readToken} from '../security.js';
import {inTenant,tenantQuery} from '../db/pools.js';
import {ensure} from '../errors.js';

export const exportsRouter=Router();
// Reviewed business datasets. Authentication/session tables never enter this export.
const tables=['stores','staff_store_grants','rooms','room_warnings','technicians','categories','items','members','orders','order_items','payments','member_transactions','reservations','clock_events','clock_reminders','inventory_movements','inventory_stocktakes','attendance','shifts','shift_entries','operation_logs','wristbands','order_groups','queue','coupons','member_levels','recharge_plans','points_log','technician_skills','wine_storage','announcements','patrol_log','swipe_log','commission_rules','payroll_snapshots','payroll_periods','approval_requests','service_consumables','suppliers','purchase_orders','purchase_order_items','inventory_transfers','inventory_transfer_items','booking_waitlist','marketing_workflows','marketing_outbox','channel_orders','channel_redemptions','booking_payment_orders','booking_refunds','booking_payment_events','pricing_rules','asset_operations','asset_lots','asset_allocations','settlement_lines','merchant_templates','coupon_profiles','template_bindings','role_permissions','device_connections','coupon_campaigns'] as const;
function redact(value:unknown):unknown{
 if(Array.isArray(value))return value.map(redact);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/password|secret|token|credential/i.test(key)).map(([key,v])=>{
  if(typeof v==='string'&&(/_json$|snapshot$/.test(key))){try{return [key,redact(JSON.parse(v))]}catch{}}
  return [key,redact(v)];
 }));
 return value;
}
async function write(res:Response,line:string){
 if(res.destroyed)throw Error('Export client disconnected');
 if(!res.write(line)){
  const controller=new AbortController(),close=()=>controller.abort();res.once('close',close);
  try{await once(res,'drain',{signal:controller.signal})}finally{res.off('close',close)}
 }
}
exportsRouter.get('/exports/business',async(req,res,next)=>{
 try{
  z.object({}).strict().parse(req.query);
  const claims=readToken(bearer(req),'merchant');ensure(claims.mid,401,'INVALID_SESSION','登录缺少商家信息');
  const digest=createHash('sha256');let count=0;
  const send=async(record:unknown)=>{const line=JSON.stringify(record)+'\n';digest.update(line);await write(res,line)};
  await inTenant(claims.mid,async()=>{
   const actor=await authorize(claims,undefined,{owner:true});
   res.setTimeout(30000,()=>res.destroy());
   res.type('application/x-ndjson');res.setHeader('Content-Disposition','attachment; filename="ZA-Thera-business.ndjson"');
   await send({type:'manifest',version:1,merchant:actor.merchant,created_at:new Date().toISOString(),datasets:tables});
   // One cursor streams all reviewed datasets. Opening/fetching/closing a cursor
   // per table imposed three network round trips even for every empty table.
   const query=tables.map(table=>`SELECT '${table}'::text AS dataset,to_jsonb(t) AS data FROM "${table}" t WHERE merchant_id=$1`).join(' UNION ALL ');
   await tenantQuery(`DECLARE export_rows NO SCROLL CURSOR FOR ${query}`,[claims.mid]);
   try{while(true){const rows=(await tenantQuery('FETCH FORWARD 250 FROM export_rows')).rows;if(!rows.length)break;for(const row of rows){await send({type:'record',dataset:row.dataset,data:redact(row.data)});count++}}}
   finally{await tenantQuery('CLOSE export_rows')}
   await audit('merchant.exported',{format:'ndjson',datasets:tables.length,records:count});
  },{},true);
  // Completion is emitted only after the snapshot and audit transaction commits.
  await write(res,JSON.stringify({type:'complete',records:count,sha256:digest.digest('hex')})+'\n');res.end();
 }catch(error){if(res.headersSent)res.destroy();else next(error)}
});
