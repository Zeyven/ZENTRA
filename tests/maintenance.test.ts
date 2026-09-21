import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
import {captureRequest,flushDiagnostics,pruneMaintenance,startMaintenanceCleanup} from '../apps/server/src/services/maintenance.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any;
before(async()=>{h=await harness();a=await h.onboard();b=await h.onboard();await flushDiagnostics()});after(()=>h.stop());
const api=(path:string,method='GET',body?:unknown,m=a)=>h.api(m.token,m.stores[0].id,path,method,body);
test('real request diagnostics omit bodies and queries; detail and export cannot cross store or tenant',async()=>{
 const secret='secret-query-'+randomUUID();succeeded(await api('/members','POST',{name:secret,phone:'13900001234'}));await api('/members?keyword='+secret);assert.equal((await api('/members','POST',{name:''})).status,400);await flushDiagnostics();
 const logs=succeeded(await api('/maintenance/logs?source=request'));assert(logs.rows.some((r:any)=>r.route==='/api/merchant/v1/members'&&r.status_code===400));assert(!JSON.stringify(logs).includes(secret));assert(!JSON.stringify(logs).includes('13900001234'));
 const row=logs.rows[0];assert.equal((await api('/maintenance/logs/request/'+row.id,'GET',undefined,b)).status,404);assert.equal((await h.api(a.token,a.stores[1].id,'/maintenance/logs/request/'+row.id)).status,404);
 const exported=succeeded(await api('/maintenance/export?source=request','POST'));assert(exported.rows.length);assert(!JSON.stringify(exported).includes(secret));const audit=succeeded(await api('/maintenance/logs?source=audit'));assert(!JSON.stringify(audit).includes(secret));
 const summary=succeeded(await api('/maintenance/summary'));assert(summary.recent.requests>=3);assert(summary.recent.rejected>=1);assert.equal(summary.coverage.length,6);assert.equal(summary.collector.failed_writes,0);
 const user=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'maintenance-manager',password,name:'店长'}));succeeded(await h.api(a.token,undefined,'/users/'+user.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'manager'}]}));const login=succeeded(await h.call('/api/merchant/v1/auth/login','POST',{merchant_code:a.merchant.code,username:'maintenance-manager',password}));assert.equal((await api('/maintenance/summary','GET',undefined,{...a,token:login.token})).status,403);
});
test('collector exits an inherited tenant transaction and retains isolated system failures',async()=>{
 const requestId=randomUUID();await inTenant(a.merchant.id,async()=>captureRequest({merchantId:b.merchant.id,storeId:b.stores[0].id,requestId,method:'POST',route:'/api/merchant/v1/test-diagnostic',status:500,duration:1201}));await flushDiagnostics();
 const logs=succeeded(await api('/maintenance/logs?source=system','GET',undefined,b));assert(logs.rows.some((r:any)=>r.request_id===requestId&&r.level==='error'));assert(!JSON.stringify(succeeded(await api('/maintenance/logs?source=system'))).includes(requestId));
});
test('diagnostic retention caps only its merchant and never removes immutable business audit',async()=>{
 await flushDiagnostics();const other=await inTenant(b.merchant.id,async()=>(await tenantQuery('SELECT count(*)::int n FROM maintenance_events')).rows[0].n);
 await inTenant(a.merchant.id,async()=>{
  const auditCount=(await tenantQuery('SELECT count(*)::int n FROM audit_events')).rows[0].n;
  await tenantQuery("INSERT INTO maintenance_events(store_id,source,level,request_id,method,route,status_code,duration_ms,created_at) SELECT $1,'request','info',gen_random_uuid(),'GET','/retention-test',200,1,CASE WHEN n=1 THEN now()-interval '31 days' ELSE now() END FROM generate_series(1,10100) n",[a.stores[0].id]);await pruneMaintenance();assert.equal((await tenantQuery('SELECT count(*)::int n FROM maintenance_events')).rows[0].n,10000);assert.equal((await tenantQuery("SELECT count(*)::int n FROM maintenance_events WHERE created_at<now()-interval '30 days'")).rows[0].n,0);assert.equal((await tenantQuery('SELECT count(*)::int n FROM audit_events')).rows[0].n,auditCount);
 });assert.equal(await inTenant(b.merchant.id,async()=>(await tenantQuery('SELECT count(*)::int n FROM maintenance_events')).rows[0].n),other);
});
test('background retention also processes inactive merchants and closes without leaving a scan running',async()=>{
 await flushDiagnostics();await inTenant(b.merchant.id,async()=>tenantQuery("INSERT INTO maintenance_events(store_id,source,level,request_id,method,route,status_code,duration_ms,created_at) VALUES($1,'request','info',$2,'GET','/old',200,1,now()-interval '31 days')",[b.stores[0].id,randomUUID()]));
 succeeded(await h.call('/api/platform/v1/merchants/'+b.merchant.id+'/status','PATCH',{status:'suspended'},h.platformToken));
 const cleanup=startMaintenanceCleanup(async()=>[{id:b.merchant.id}]);await cleanup.run();await cleanup.close();assert.equal(await inTenant(b.merchant.id,async()=>(await tenantQuery("SELECT count(*)::int n FROM maintenance_events WHERE created_at<now()-interval '30 days'")).rows[0].n),0);
});
