import {inTenant,platformPool,tenantQuery} from './db/pools.js';
import {scanClockReminders} from './services/clocks.js';
import {scanMerchantMarketing} from './services/marketing.js';
import {scanMerchantBookings} from './services/public-booking.js';
// Registry access exposes merchant metadata only; every business scan uses a fresh RLS transaction.
export async function scanMerchantClocks(merchantId:string){
 return inTenant(merchantId,async()=>{
  const merchant=(await tenantQuery('SELECT status FROM merchants WHERE id=$1',[merchantId])).rows[0];if(merchant?.status!=='active')return 0;
  const lock=(await tenantQuery('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',[merchantId+':clock-reminders'])).rows[0];if(!lock.acquired)return 0;
  return scanClockReminders();
 },{role:'system'});
}
interface ClockJobDependencies {
 list:(cursor:string|null)=>Promise<Array<{id:string}>>;
 scan:(id:string)=>Promise<unknown>;
}
const clockDependencies:ClockJobDependencies={
 list:async cursor=>(await platformPool.query("SELECT id FROM merchants WHERE status='active' AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 20",[cursor])).rows,
 scan:async id=>{await scanMerchantClocks(id);await scanMerchantMarketing(id);await scanMerchantBookings(id)}
};
export function startClockJobs(dependencies:ClockJobDependencies=clockDependencies){
 let stopped=false,running:Promise<void>|null=null,cursor:string|null=null,lastSuccess=0,lastError:string|null=null;
 let failures=new Set<string>(),sweepFailures=new Set<string>();
 async function tick(){
  const merchants=await dependencies.list(cursor);
  for(const merchant of merchants){
   if(stopped)return;
   try{await dependencies.scan(merchant.id);failures.delete(merchant.id)}
   catch(e){failures.add(merchant.id);sweepFailures.add(merchant.id);console.error(JSON.stringify({event:'clock_jobs.merchant_failed',merchant_id:merchant.id,code:errorCode(e)}))}
   finally{cursor=merchant.id}
  }
  // Finish the sweep even when one tenant fails. Suspended/deleted tenants must not
  // keep readiness degraded forever; retain only failures encountered this sweep.
  if(merchants.length<20){cursor=null;failures=sweepFailures;sweepFailures=new Set()}
  lastSuccess=Date.now();lastError=null;
 }
 const run=()=>{if(stopped)return Promise.resolve();if(running)return running;running=tick().catch(e=>{lastError=errorCode(e);console.error(JSON.stringify({event:'clock_jobs.failed',code:lastError}))}).finally(()=>{running=null});return running};
 const timer=setInterval(run,5000);timer.unref();run();
 return {healthy:()=>lastSuccess>0&&!lastError&&failures.size===0&&Date.now()-lastSuccess<60000,status:()=>({last_success_at:lastSuccess?new Date(lastSuccess).toISOString():null,error:lastError,failed_merchants:failures.size}),run,close:async()=>{stopped=true;clearInterval(timer);await running}};
}
function errorCode(error:unknown){const code=(error as {code?:unknown})?.code;return typeof code==='string'&&/^[A-Z0-9_]{1,40}$/.test(code)?code:'JOB_FAILED'}
