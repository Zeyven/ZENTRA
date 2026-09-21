// Run beside a staged release, exclusively against the isolated test API/database.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {platformPool,closePools} from './apps/server/dist/db/pools.js';
import {hashPassword} from './apps/server/dist/security.js';
assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL).pathname,'/za_spa_saas_test');
const origin='http://127.0.0.1:8794',password=randomBytes(10).toString('hex'),username='load-'+randomUUID();
const devices=[],sockets=[],latencies=[],oldLatencies=[],errors=[];let eventCount=0,crossTenantEvents=0;
async function api(path,body,token,store,method=body?'POST':'GET'){
 const response=await fetch(origin+path,{method,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(store?{'X-Store-ID':String(store)}:{}),'Idempotency-Key':randomUUID()},body:body?JSON.stringify(body):undefined});
 const value=await response.json();assert(response.ok&&value.ok,`${method} ${path} returned ${response.status} ${value.code??''}`);return value.data;
}
function connect(d){return new Promise((resolve,reject)=>{
 const socket=new WebSocket('ws://127.0.0.1:8794/socket.io/?EIO=4&transport=websocket');sockets.push(socket);
 const timer=setTimeout(()=>{socket.close();reject(Error('Socket connection timeout'))},15000);
 socket.onmessage=message=>{const packet=String(message.data);if(packet.startsWith('0'))socket.send('40'+JSON.stringify({token:d.token,store_id:d.store,protocol_version:1}));else if(packet==='2')socket.send('3');else if(packet.startsWith('42')){const [name,data]=JSON.parse(packet.slice(2));if(name==='session.ready'){clearTimeout(timer);resolve()}if(name==='data.changed'){eventCount++;if(data.merchant_id!==d.merchant||data.store_id!==d.store)crossTenantEvents++}}};
 socket.onerror=()=>{clearTimeout(timer);reject(Error('Socket failed'))};
})}
const p95=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length*.95)]??0;
try{
 await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3)',[username,await hashPassword(password),'隔离容量验收']);
 const platform=await api('/api/platform/v1/auth/login',{username,password});
 for(let m=0;m<20;m++){
  const code='CAP-'+randomUUID().slice(0,8),created=await api('/api/platform/v1/merchants',{code,name:'隔离容量验收 '+m,member_mode:'store'},platform.token);
  await api('/api/merchant/v1/auth/activate',{token:created.invite.token,username:'owner',password,name:'容量验收'});
  const auth=await api('/api/merchant/v1/auth/login',{merchant_code:code,username:'owner',password});
  for(let s=0;s<5;s++){
   const store=await api('/api/merchant/v1/stores',{code:String(s+1),name:'测试店 '+s},auth.token);
   let room;for(let r=0;r<3;r++)room=await api('/api/merchant/v1/rooms',{room_no:String(r+1)},auth.token,store.id);
   devices.push({token:auth.token,store:store.id,merchant:created.merchant.id,room:room.id,patrol:0});
  }
  console.log(JSON.stringify({setup_merchants:m+1}));
 }
 for(let i=0;i<devices.length;i+=5)await Promise.all(devices.slice(i,i+5).map(connect));
 const started=performance.now();
 await Promise.all([
  ...devices.map(async(d,i)=>{await new Promise(r=>setTimeout(r,i*40));for(let round=0;round<24;round++){
   const t=performance.now();try{await api('/api/merchant/v1/snapshot',null,d.token,d.store);latencies.push(performance.now()-t);
    if(round%6===0){const w=performance.now();const data=await api('/api/merchant/v1/patrol',{room_id:d.room,status:'normal',expected_id:d.patrol},d.token,d.store);d.patrol=data.record.id;latencies.push(performance.now()-w)}
   }catch(e){errors.push(e.message)}
   await new Promise(r=>setTimeout(r,Math.max(0,5000-(performance.now()-t))));
  }}),
  (async()=>{for(let i=0;i<62;i++){const t=performance.now();try{const r=await fetch('http://127.0.0.1:8787/ready',{signal:AbortSignal.timeout(2000)});assert(r.ok);oldLatencies.push(performance.now()-t)}catch{errors.push('Old service health degraded')}await new Promise(r=>setTimeout(r,2000))}})()
 ]);
 const result={merchants:20,stores:100,devices:100,duration_seconds:(performance.now()-started)/1000,requests:latencies.length,p95_ms:p95(latencies),max_ms:Math.max(...latencies),old_health_samples:oldLatencies.length,old_p95_ms:p95(oldLatencies),event_count:eventCount,cross_tenant_events:crossTenantEvents,connected:sockets.filter(s=>s.readyState===WebSocket.OPEN).length,errors,passed:errors.length===0&&p95(latencies)<1000&&p95(oldLatencies)<250&&crossTenantEvents===0&&eventCount>0&&sockets.every(s=>s.readyState===WebSocket.OPEN)};
 await writeFile('/opt/za-spa-saas/operator/capacity-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));assert(result.passed,'Capacity acceptance failed');
}finally{for(const s of sockets)s.close();await closePools()}
