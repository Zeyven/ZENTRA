import {inTenant,tenantQuery,tenantStorage,platformPool} from '../db/pools.js';

export interface RequestDiagnostic{merchantId:string;storeId?:number;userId?:number;requestId:string;method:string;route:string;status:number;duration:number}
const queue:RequestDiagnostic[]=[];
const states=new Map<string,{failed_writes:number;last_failure_at:string|null;last_write_at:string|null}>();
const started_at=new Date().toISOString();
let draining:Promise<void>|null=null;
function state(id:string){let value=states.get(id);if(!value){value={failed_writes:0,last_failure_at:null,last_write_at:null};states.set(id,value)}return value}
function failed(id:string,count:number){const value=state(id);value.failed_writes+=count;value.last_failure_at=new Date().toISOString()}
export function collectorStatus(id:string){return {started_at,...state(id)}}
export function captureRequest(row:RequestDiagnostic){
 // No body, query string, credentials, customer data or exception text is accepted.
 if(queue.length>=1000){failed(row.merchantId,1);return}
 queue.push(row);if(!draining)draining=tenantStorage.exit(()=>drain()).finally(()=>{draining=null});
}
async function drain(){
 while(queue.length){
  const first=queue.shift()!,batch=[first];
  for(let i=0;i<queue.length&&batch.length<50;){if(queue[i].merchantId===first.merchantId)batch.push(queue.splice(i,1)[0]);else i++}
  try{
   await inTenant(first.merchantId,async()=>{
    await tenantQuery("SELECT pg_advisory_xact_lock(hashtextextended($1||':maintenance',0))",[first.merchantId]);
    const records=batch.flatMap(r=>{const value={store_id:r.storeId??null,user_id:r.userId??null,source:'request',level:r.status>=500?'error':r.status>=400?'warn':'info',request_id:r.requestId,method:r.method.slice(0,16),route:r.route.slice(0,200),status_code:r.status,duration_ms:Math.min(2147483647,Math.max(0,Math.round(r.duration)))};return r.status>=500?[value,{...value,source:'system'}]:[value]});
    await tenantQuery(`INSERT INTO maintenance_events(store_id,user_id,source,level,request_id,method,route,status_code,duration_ms)
     SELECT store_id,user_id,source,level,request_id,method,route,status_code,duration_ms FROM jsonb_to_recordset($1::jsonb) AS r(store_id bigint,user_id bigint,source text,level text,request_id uuid,method text,route text,status_code int,duration_ms int)`,[JSON.stringify(records)]);
    await pruneMaintenance();
   });state(first.merchantId).last_write_at=new Date().toISOString();
  }catch{failed(first.merchantId,batch.length)}
 }
}
export async function pruneMaintenance(){
 // Applies only to diagnostics, never to financial history or business audit.
 await tenantQuery("DELETE FROM maintenance_events WHERE created_at<now()-interval '30 days' OR id IN(SELECT id FROM maintenance_events ORDER BY id DESC OFFSET 10000)");
}
export async function flushDiagnostics(){while(draining)await draining}
export function startMaintenanceCleanup(list=async(cursor:string|null)=>(await platformPool.query('SELECT id FROM merchants WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 20',[cursor])).rows as Array<{id:string}>){
 let stopped=false,cursor:string|null=null,running:Promise<void>|null=null;
 async function sweep(){const merchants=await list(cursor);for(const merchant of merchants){if(stopped)return;try{await inTenant(merchant.id,pruneMaintenance)}catch{failed(merchant.id,1)}finally{cursor=merchant.id}}if(merchants.length<20)cursor=null}
 const run=()=>{if(stopped)return Promise.resolve();if(!running)running=sweep().catch(()=>{console.error(JSON.stringify({event:'maintenance.cleanup_failed'}))}).finally(()=>{running=null});return running};
 const timer=setInterval(run,60000);timer.unref();void run();return {run,close:async()=>{stopped=true;clearInterval(timer);await running}};
}
