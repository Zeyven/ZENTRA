import type {Request} from 'express';
import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {context,tenantQuery} from './db/pools.js';
import {digest} from './security.js';
import {ensure} from './errors.js';
export const Id=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const Money=z.union([z.number().finite(),z.string().regex(/^-?\d+(\.\d{1,2})?$/)]).transform(v=>new Decimal(v)).refine(v=>v.abs().lte('999999999999.99')&&v.decimalPlaces()<=2,'金额超出范围或精度').transform(v=>v.toNumber());
export const PositiveMoney=Money.refine(v=>v>=0,'金额不能为负数');
export const Count=z.number().int().min(0).max(1000000000);
export const money=(value:Decimal.Value)=>new Decimal(value).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toNumber();
export const sum=(values:Decimal.Value[])=>values.reduce<Decimal>((total,value)=>total.plus(value),new Decimal(0));
export function input(req:Request){const {store_id,request_key,...body}=req.body??{};return body}
export function canonical(value:any):string{
 if(value instanceof Date)return JSON.stringify(value.toISOString());
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
export async function idempotent<T>(req:Request,route:string,operation:()=>Promise<T>):Promise<T>{
 const key=z.string().trim().min(8).max(128).parse(req.headers['idempotency-key']??req.body?.request_key);
 const c=context();ensure(c.storeId,400,'STORE_REQUIRED','请先选择门店');
 const hash=digest(canonical({body:req.body??{},store:c.storeId,user:c.userId??null,platform_user:c.platformUserId??null,support:c.supportGrant??null}));
 await tenantQuery('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${c.merchantId}:${c.storeId}:${route}:${key}`]);
 const previous=(await tenantQuery('SELECT * FROM idempotency_records WHERE store_id=$1 AND route=$2 AND request_key=$3',[c.storeId,route,key])).rows[0];
 if(previous){ensure(previous.request_hash===hash,409,'IDEMPOTENCY_CONFLICT','同一请求编号对应的内容已变化');return previous.response_json}
 const result=await operation();
 await tenantQuery('INSERT INTO idempotency_records(store_id,route,request_key,request_hash,response_json) VALUES($1,$2,$3,$4,$5)',[c.storeId,route,key,hash,JSON.stringify(result)]);return result;
}
export async function storeObject(table:string,id:number,storeId:number,lock=false){
 ensure(/^[a-z_]+$/.test(table),500,'INTERNAL_ERROR','Invalid table');
 const row=(await tenantQuery(`SELECT * FROM ${table} WHERE id=$1 AND store_id=$2${lock?' FOR UPDATE':''}`,[id,storeId])).rows[0];ensure(row,404,'NOT_FOUND','记录不存在或不属于当前门店');return row;
}
