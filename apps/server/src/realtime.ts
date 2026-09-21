import {Server as HttpServer} from 'node:http';
import {Server,Socket} from 'socket.io';
import {z} from 'zod';
import pg from 'pg';
import {authorize} from './access.js';
import {inTenant,tenantQuery} from './db/pools.js';
import {readToken,type Claims} from './security.js';
import {ensure} from './errors.js';
import {visibleTopic} from './services/page-access.js';
export async function attachRealtime(server:HttpServer,onFatal?:(error:Error)=>void){
 const origins=[process.env.PUBLIC_ORIGIN,'zaspa-saas://app',...(process.env.NODE_ENV!=='production'?['http://127.0.0.1:5175','http://localhost:5175','http://127.0.0.1:5176']:[])].filter(Boolean) as string[];
 const io=new Server(server,{path:'/socket.io',cors:{origin:origins},serveClient:false,maxHttpBufferSize:16384});
 const listener=new pg.Client({connectionString:process.env.DATABASE_URL,application_name:'za-spa-saas-realtime'});await listener.connect();
 let closed=false,failed=false;const dirty=new Set<string>(),accessDirty=new Set<string>();let timer:NodeJS.Timeout|undefined;
 io.use(async(socket,next)=>{try{
  const auth=z.object({token:z.string().max(4096),store_id:z.number().int().positive(),protocol_version:z.literal(1)}).strict().parse(socket.handshake.auth);
  const claims=readToken(auth.token,'merchant');ensure(claims.mid,401,'INVALID_SESSION','商家会话无效');
  await inTenant(claims.mid,()=>authorize(claims,auth.store_id,{store:true,support:'read'}));
  socket.data={claims,storeId:auth.store_id,cursor:0};next();
 }catch{next(new Error('实时连接认证失败或门店授权已撤销'))}});
 io.on('connection',socket=>{
  socket.emit('session.ready',{protocol_version:1,merchant_id:socket.data.claims.mid,store_id:socket.data.storeId,server_now:Date.now()});
 });
 async function refreshMerchant(merchantId:string,accessChanged=false){
  const groups=new Map<string,Socket[]>();
  for(const socket of io.sockets.sockets.values())if(socket.data.claims?.mid===merchantId){const claims:Claims=socket.data.claims;const key=claims.realm+':'+claims.sid+':'+socket.data.storeId+':'+(claims.grant??'')+':'+(claims.platform_admin===true);const group=groups.get(key)??[];group.push(socket);groups.set(key,group)}
  for(const sockets of groups.values()){
   const first=sockets[0],after=Math.min(...sockets.map(s=>s.data.cursor??0));try{
    const payload=await inTenant(merchantId,async()=>{
     const actor=await authorize(first.data.claims,first.data.storeId,{store:true,support:'read'});
     // Only a cursor and invalidation topics leave the server. Business data always goes through authorized APIs.
     const rows=(await tenantQuery(`SELECT id,topic,store_id FROM domain_events WHERE id>$3 AND (store_id=$1 OR store_id IS NULL)
      AND ($2::boolean=false OR topic ~ '^(clock|technician|session|room-warning|access)') ORDER BY id DESC LIMIT 200`,[actor.storeId,actor.role==='technician',after])).rows;
     return {merchant_id:merchantId,store_id:actor.storeId,id:rows[0]?.id??after,topics:[...new Set([...rows.filter(r=>visibleTopic(r.topic,actor)).map(r=>r.topic),...(rows.length===200?['access.changed']:[])])],server_now:Date.now()};
    });
    for(const socket of sockets)if(socket.connected){if(accessChanged)socket.emit('access.changed',{merchant_id:merchantId,store_id:socket.data.storeId});if(payload.id>socket.data.cursor){socket.data.cursor=payload.id;if(payload.topics.length)socket.emit('data.changed',payload)}}
   }catch(error:any){
    if([401,403].includes(error?.status)){for(const socket of sockets){socket.emit('access.revoked',{message:'登录或门店授权已变化，请重新登录或选择门店'});socket.disconnect(true)}}
    else{console.error(JSON.stringify({event:'realtime.authorization.failed',code:error?.code}));for(const socket of sockets)socket.disconnect(true)}
   }
  }
 }
 let flushing:Promise<void>=Promise.resolve();
 function schedule(mid:string,accessChanged=false){dirty.add(mid);if(accessChanged)accessDirty.add(mid);if(timer||closed)return;timer=setTimeout(()=>{timer=undefined;const merchants=[...dirty],access=new Set(accessDirty);dirty.clear();accessDirty.clear();flushing=flushing.then(async()=>{for(const merchant of merchants)await refreshMerchant(merchant,access.has(merchant))}).catch(error=>console.error(JSON.stringify({event:'realtime.flush.failed',code:error?.code})))},25)}
 listener.on('notification',message=>{
  try{const payload=JSON.parse(message.payload??'{}');if(payload.merchant_id&&z.uuid().safeParse(payload.merchant_id).success)schedule(payload.merchant_id,message.channel==='saas_access');
   else if(message.channel==='saas_access')for(const socket of io.sockets.sockets.values())schedule(socket.data.claims.mid,true);
  }catch{console.error(JSON.stringify({event:'realtime.invalid_notification'}))}
 });
 listener.on('error',error=>{
  failed=true;console.error(JSON.stringify({event:'realtime.listener.failed',message:error.message}));
  // Fail closed; systemd restarts the service when the durable event listener cannot be trusted.
  io.disconnectSockets(true);if(onFatal)onFatal(error);else server.close();
 });
 await listener.query('LISTEN saas_events');await listener.query('LISTEN saas_access');
 const expiryCheck=setInterval(()=>{for(const socket of io.sockets.sockets.values())schedule(socket.data.claims.mid)},30000);expiryCheck.unref();
 return {io,healthy:()=>!failed,close:async()=>{closed=true;if(timer)clearTimeout(timer);clearInterval(expiryCheck);await flushing;await new Promise<void>(resolve=>io.close(()=>resolve()));await listener.end()}};
}
