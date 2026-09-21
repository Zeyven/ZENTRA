import type {Request} from 'express';
import {z} from 'zod';
import {context,tenantQuery} from '../db/pools.js';
import {canonical} from '../business.js';
import {digest} from '../security.js';
import {ensure} from '../errors.js';
// Merchant operations work before the first store exists and retain their identity across store switches.
export async function merchantIdempotent<T>(req:Request,route:string,operation:()=>Promise<T>):Promise<T>{
 const key=z.string().trim().min(8).max(128).parse(req.headers['idempotency-key']);const c=context();
 const hash=digest(canonical({body:req.body??{},user:c.userId??null,platform_user:c.platformUserId??null,support:c.supportGrant??null}));
 await tenantQuery('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${c.merchantId}:merchant:${route}:${key}`]);
 const previous=(await tenantQuery('SELECT * FROM merchant_operation_requests WHERE route=$1 AND request_key=$2',[route,key])).rows[0];
 if(previous){ensure(previous.request_hash===hash,409,'IDEMPOTENCY_CONFLICT','同一请求编号对应的内容或操作账号已变化');return previous.response_json}
 const result=await operation();await tenantQuery('INSERT INTO merchant_operation_requests(route,request_key,request_hash,response_json) VALUES($1,$2,$3,$4)',[route,key,hash,JSON.stringify(result)]);return result;
}
