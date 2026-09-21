import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createApp} from '../apps/server/src/app.js';
import {platformPool,closePools} from '../apps/server/src/db/pools.js';
import {hashPassword} from '../apps/server/src/security.js';
import {attachRealtime} from '../apps/server/src/realtime.js';
import {flushDiagnostics} from '../apps/server/src/services/maintenance.js';
export const password='Test-Secret-867!';
export async function harness(options:{realtime?:boolean;closePoolsOnStop?:boolean}={}){
 assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/za_spa_saas_test');
 const server=createServer(createApp());const realtime=options.realtime?await attachRealtime(server):undefined;server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const username='admin-'+randomUUID();await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3)',[username,await hashPassword(password),'测试平台管理员']);
 async function call(path:string,method='GET',body?:unknown,token?:string,store?:number,key?:string){
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(store?{'X-Store-ID':String(store)}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,...await response.json() as any};
 }
 const login=await call('/api/platform/v1/auth/login','POST',{username,password});assert.equal(login.status,200,JSON.stringify(login));
 const platformToken=login.data.token;
 const api=(token:string,store:number|undefined,path:string,method='GET',body?:unknown,key=randomUUID())=>call('/api/merchant/v1'+path,method,body,token,store,key);
 async function onboard(mode:'store'|'merchant'='merchant'){
  const code='M-'+randomUUID().slice(0,8).toUpperCase();const created=await call('/api/platform/v1/merchants','POST',{code,name:code,member_mode:mode},platformToken);assert.equal(created.status,200,JSON.stringify(created));
  const activated=await call('/api/merchant/v1/auth/activate','POST',{token:created.data.invite.token,username:'13800138000',password,name:'测试老板'});assert.equal(activated.status,200,JSON.stringify(activated));
  const logged=await call('/api/merchant/v1/auth/login','POST',{merchant_code:code,username:'13800138000',password});assert.equal(logged.status,200,JSON.stringify(logged));
  const tenant=logged.data;tenant.stores=[];
  for(let i=1;i<=2;i++){const store=await api(tenant.token,undefined,'/stores','POST',{code:'00'+i,name:code+' '+i+'店'});assert.equal(store.status,200,JSON.stringify(store));tenant.stores.push(store.data)}
  return tenant;
 }
 return {api,call,onboard,origin,platformToken,platformUserId:login.data.user.id as number,stop:async()=>{if(realtime)await realtime.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await flushDiagnostics();if(options.closePoolsOnStop!==false)await closePools()}};
}
export function succeeded(result:any){assert.equal(result.status,200,JSON.stringify(result));return result.data}
