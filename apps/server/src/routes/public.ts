import {Router,type Request,type RequestHandler} from 'express';
import {z} from 'zod';
import {inTenant,platformPool,tenantQuery,context} from '../db/pools.js';
import {Id,idempotent} from '../business.js';
import {ensure} from '../errors.js';
import {digest} from '../security.js';
import {QueueInput,queueTake,queueSummary} from '../services/queue.js';
export const publicRouter=Router();
export function publicStore(write:boolean,handler:(req:Request,store:any)=>Promise<unknown>):RequestHandler{return async(req,res,next)=>{try{
 const code=z.string().min(1).max(40).parse(req.params.merchantCode),storeCode=z.string().min(1).max(40).parse(req.params.storeCode);
 // Platform lookup exposes only the merchant identity. All store/business access uses
 // a fresh tenant transaction, including anonymous requests.
 const merchant=(await platformPool.query('SELECT id,status FROM merchants WHERE code=$1',[code.toUpperCase()])).rows[0];ensure(merchant,404,'NOT_FOUND','商家或门店入口不存在');
 const result=await inTenant(merchant.id,async()=>{const store=(await tenantQuery('SELECT id,code,name,status FROM stores WHERE code=$1',[storeCode])).rows[0];ensure(store,404,'NOT_FOUND','商家或门店入口不存在');Object.assign(context(),{storeId:store.id,role:'public'});
 if(write)ensure(merchant.status==='active'&&store.status===1,403,'STORE_UNAVAILABLE','门店暂未接受新业务');
 return handler(req,{...store,available:merchant.status==='active'&&store.status===1});});res.json({ok:true,data:result});
 }catch(error){next(error)}}}
export async function throttle(req:Request){
 const bucket='queue:'+digest(req.ip??'unknown');
 const row=(await tenantQuery(`INSERT INTO public_rate_limits(store_id,bucket,window_start,hits) VALUES($1,$2,now(),1)
 ON CONFLICT(merchant_id,store_id,bucket) DO UPDATE SET hits=CASE WHEN public_rate_limits.window_start<now()-interval '10 minutes' THEN 1 ELSE public_rate_limits.hits+1 END,
 window_start=CASE WHEN public_rate_limits.window_start<now()-interval '10 minutes' THEN now() ELSE public_rate_limits.window_start END RETURNING hits`,[context().storeId,bucket])).rows[0];
 ensure(row.hits<=10,429,'RATE_LIMITED','操作过于频繁，请稍后再试');
}
const scope='/:merchantCode/:storeCode';
publicRouter.get(scope+'/queue',publicStore(false,async(_req,store)=>({store:{name:store.name,code:store.code,available:store.available},summary:await queueSummary()})));
publicRouter.post(scope+'/queue/take',publicStore(true,async req=>idempotent(req,'queue.public_take',async()=>{const b=QueueInput.parse(req.body);await throttle(req);return queueTake(b,true)})));
publicRouter.get(scope+'/queue/:id',publicStore(false,async req=>{
 const token=z.string().regex(/^Bearer [A-Za-z0-9_-]{43}$/).parse(req.headers.authorization).slice(7);
 const row=(await tenantQuery('SELECT id,queue_no,people,status,created_at,called_at,version FROM queue WHERE id=$1 AND store_id=$2 AND access_token_hash=$3',[Id.parse(req.params.id),context().storeId,digest(token)])).rows[0];ensure(row,404,'NOT_FOUND','排号凭据无效');return row;
}));
