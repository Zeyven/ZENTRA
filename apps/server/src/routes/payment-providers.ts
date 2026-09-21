import {Router} from 'express';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {idempotent,input,Id} from '../business.js';
import {ensure} from '../errors.js';
import {protect} from './integrations.js';
import {dateRange} from '../services/dates.js';
export const paymentProvidersRouter=Router();
const provider=z.enum(['wechat','alipay']),read={store:true,roles:['manager'],support:'read' as const},write={store:true,roles:['manager'],write:true,support:'configuration' as const};
const view=(r:any)=>({id:r.id,provider:r.provider,enabled:false,status:'not_connected',merchant_ref:r.merchant_ref,gateway_base_url:r.gateway_base_url,mode:r.mode,secret_configured:Boolean(r.webhook_secret),webhook_path:null});
paymentProvidersRouter.get('/payments/providers',merchantRoute(read,async(_req,actor)=>(await tenantQuery('SELECT * FROM booking_payment_providers WHERE store_id=$1 ORDER BY provider',[actor.storeId])).rows.map(view)));
paymentProvidersRouter.put('/payments/providers/:provider',merchantRoute(write,async(req,actor)=>idempotent(req,'payment.provider:'+req.params.provider,async()=>{
 const type=provider.parse(req.params.provider),b=z.object({enabled:z.boolean(),merchant_ref:z.string().trim().max(100),gateway_base_url:z.union([z.literal(''),z.url().max(2000).refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash},'网关须使用不含登录信息的 HTTPS 地址')]),mode:z.enum(['production','sandbox']),webhook_secret:z.string().max(500).optional()}).strict().parse(input(req));
 ensure(!b.enabled,409,'PAYMENT_NOT_CONNECTED','支付服务商尚未接入，当前只能保存准备配置');if(b.webhook_secret)ensure(b.webhook_secret.length>=24,400,'INVALID_SECRET','签名密钥至少 24 位');
 const encrypted=b.webhook_secret?protect(b.webhook_secret,actor.merchant.id+':'+actor.storeId+':payment:'+type):null;
 const row=(await tenantQuery(`INSERT INTO booking_payment_providers(store_id,provider,enabled,merchant_ref,gateway_base_url,mode,webhook_secret) VALUES($1,$2,0,$3,$4,$5,$6)
 ON CONFLICT(merchant_id,store_id,provider) DO UPDATE SET enabled=0,merchant_ref=excluded.merchant_ref,gateway_base_url=excluded.gateway_base_url,mode=excluded.mode,webhook_secret=coalesce(excluded.webhook_secret,booking_payment_providers.webhook_secret),updated_at=now() RETURNING *`,[actor.storeId,type,b.merchant_ref,b.gateway_base_url,b.mode,encrypted])).rows[0];
 await audit('payment.provider.configured',{provider:type,merchant_ref:b.merchant_ref,secret_changed:Boolean(encrypted),status:'not_connected'},'booking_payment_provider',row.id);await event('payment.configuration.changed',row.id);return view(row);
})));
for(const [path,table] of [['orders','booking_payment_orders'],['refunds','booking_refunds']] as const){
 paymentProvidersRouter.get('/payments/booking/'+path,merchantRoute(read,async(req,actor)=>{
  const q=z.object({status:z.string().max(40).optional(),before:Id.optional()}).strict().parse(req.query),columns=path==='orders'?'p.payment_no,p.provider,p.paid_at,p.created_at':'p.refund_no,p.refunded_at,p.requested_at,p.cancellation_fee';
  return (await tenantQuery(`SELECT p.id,p.reservation_id,p.amount,p.status,${columns},r.customer_name FROM ${table} p JOIN reservations r ON r.merchant_id=p.merchant_id AND r.id=p.reservation_id WHERE p.store_id=$1 AND ($2::text IS NULL OR p.status=$2) AND ($3::bigint IS NULL OR p.id<$3) ORDER BY p.id DESC LIMIT 100`,[actor.storeId,q.status||null,q.before??null])).rows;
 }));
}
paymentProvidersRouter.get('/payments/booking/reconciliation',merchantRoute(read,async(req,actor)=>{
 const range=dateRange(req.query);
 const paid=(await tenantQuery("SELECT coalesce(sum(amount),0) amount FROM booking_payment_orders WHERE store_id=$1 AND status='paid' AND paid_at>=$2 AND paid_at<$3",[actor.storeId,range.from,range.until])).rows[0].amount;
 const refunds=(await tenantQuery("SELECT coalesce(sum(amount),0) amount FROM booking_refunds WHERE store_id=$1 AND status='refunded' AND refunded_at>=$2 AND refunded_at<$3",[actor.storeId,range.from,range.until])).rows[0].amount;
 const anomalies=(await tenantQuery(`SELECT p.id,p.payment_no,'DEPOSIT_MISMATCH' AS code FROM booking_payment_orders p JOIN reservations r ON r.merchant_id=p.merchant_id AND r.id=p.reservation_id WHERE p.store_id=$1 AND p.status='paid' AND p.applied_order_id IS NULL AND NOT EXISTS(SELECT 1 FROM booking_refunds f WHERE f.payment_order_id=p.id AND f.status='refunded') AND p.amount<>r.deposit ORDER BY p.id LIMIT 100`,[actor.storeId])).rows;
 return {payment_amount:paid,refund_amount:refunds,net_deposit:new Decimal(paid).minus(refunds).toNumber(),anomalies,start:range.start,end:range.end};
}));
paymentProvidersRouter.post('/payments/providers/:provider/create',merchantRoute({...write,support:undefined},async req=>{provider.parse(req.params.provider);ensure(false,409,'PAYMENT_NOT_CONNECTED','支付接口尚未接入，未创建外部支付或扣款')}));
