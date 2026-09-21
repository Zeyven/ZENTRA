import pg,{type PoolClient,type QueryResultRow} from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
import assert from 'node:assert/strict';
pg.types.setTypeParser(20,value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Database integer exceeds safe range');return n});
pg.types.setTypeParser(1700,value=>Number(value));
export interface TenantContext{merchantId:string;client:PoolClient;userId?:number;role?:string;storeId?:number;supportGrant?:string;platformUserId?:number;platformAdmin?:boolean}
export const tenantStorage=new AsyncLocalStorage<TenantContext>();
const config=(name:string)=>{const value=process.env[name];if(!value)throw Error(`Missing ${name}`);return {connectionString:value,max:8,idleTimeoutMillis:10000,connectionTimeoutMillis:5000,application_name:'za-spa-saas',options:'-c timezone=Asia/Shanghai -c statement_timeout=15000'}};
export const runtimePool=new pg.Pool(config('DATABASE_URL'));
export const platformPool=new pg.Pool(config('PLATFORM_DATABASE_URL'));
export function context(){const c=tenantStorage.getStore();if(!c)throw Error('Tenant context is required');return c}
export async function tenantQuery<T extends QueryResultRow=any>(sql:string,values:unknown[]=[]){return context().client.query<T>(sql,values)}
export async function inTenant<T>(merchantId:string,fn:()=>Promise<T>,extra:Partial<TenantContext>={},snapshot=false):Promise<T>{
 assert.match(merchantId,/^[0-9a-f-]{36}$/i);
 const existing=tenantStorage.getStore();
 if(existing){assert.equal(existing.merchantId,merchantId,'Nested merchant change denied');return fn()}
 const client=await runtimePool.connect();
 try{
  await client.query(snapshot?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN');await client.query("SELECT set_config('app.merchant_id',$1,true),pg_advisory_xact_lock_shared(hashtextextended($1||':restore',0))",[merchantId]);
  const result=await tenantStorage.run({...extra,merchantId,client},fn);
  await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function platformTransaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{
 const c=await platformPool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function closePools(){await Promise.all([runtimePool.end(),platformPool.end()])}
