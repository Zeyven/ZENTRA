import {Router} from 'express';
import {z} from 'zod';
import {createCipheriv,randomBytes} from 'node:crypto';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {idempotent,input,Id} from '../business.js';
import {ensure} from '../errors.js';
export const integrationsRouter=Router();
const channel=z.enum(['meituan','douyin','wechat','miniprogram']);
const read={store:true,roles:['manager'],support:'read' as const},write={store:true,roles:['manager'],write:true,support:'configuration' as const};
export function protect(secret:string,scope:string){
 const key=process.env.AUTH_ENCRYPTION_KEY;ensure(key&&/^[a-f0-9]{64}$/i.test(key),503,'ENCRYPTION_UNAVAILABLE','认证配置加密服务不可用');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);cipher.setAAD(Buffer.from(scope));
 const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return ['aes256gcm-v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join(':');
}
const view=(row:any)=>({id:row.id,channel:row.channel,merchant_ref:row.merchant_ref,enabled:false,status:'not_connected',secret_configured:Boolean(row.webhook_secret),last_received_at:row.last_received_at,webhook_path:null});
integrationsRouter.get('/integrations/connections',merchantRoute(read,async(_req,actor)=>(await tenantQuery('SELECT * FROM channel_connections WHERE store_id=$1 ORDER BY channel',[actor.storeId])).rows.map(view)));
integrationsRouter.put('/integrations/connections/:channel',merchantRoute(write,async(req,actor)=>idempotent(req,'integration.configure:'+req.params.channel,async()=>{
 const kind=channel.parse(req.params.channel),body=z.object({enabled:z.boolean(),merchant_ref:z.string().trim().max(100),webhook_secret:z.string().max(500).optional()}).strict().parse(input(req));
 ensure(!body.enabled,409,'CHANNEL_NOT_CONNECTED','渠道适配器尚未接入，当前只能保存配置，不能启用真实核销或收款');
 if(body.webhook_secret)ensure(body.webhook_secret.length>=24,400,'INVALID_SECRET','签名密钥至少 24 位');
 const encrypted=body.webhook_secret?protect(body.webhook_secret,actor.merchant.id+':'+actor.storeId+':'+kind):null;
 const row=(await tenantQuery(`INSERT INTO channel_connections(store_id,channel,enabled,merchant_ref,webhook_secret) VALUES($1,$2,0,$3,$4)
 ON CONFLICT(merchant_id,store_id,channel) DO UPDATE SET enabled=0,merchant_ref=excluded.merchant_ref,webhook_secret=coalesce(excluded.webhook_secret,channel_connections.webhook_secret),updated_at=now() RETURNING *`,[actor.storeId,kind,body.merchant_ref,encrypted])).rows[0];
 await audit('integration.configured',{channel:kind,merchant_ref:body.merchant_ref,secret_changed:Boolean(encrypted),status:'not_connected'},'channel_connection',row.id);await event('integration.changed',row.id);return view(row);
})));
integrationsRouter.get('/integrations/orders',merchantRoute(read,async(req,actor)=>{
 const before=req.query.before?Id.parse(req.query.before):null;return (await tenantQuery('SELECT id,channel,external_order_no,voucher_code,amount,status,received_at FROM channel_orders WHERE store_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 100',[actor.storeId,before])).rows;
}));
integrationsRouter.post('/integrations/:channel/redeem',merchantRoute({...write,support:undefined},async req=>{channel.parse(req.params.channel);ensure(false,409,'CHANNEL_NOT_CONNECTED','团购核销接口尚未接入，未执行核销或扣款')}));
