import net from 'node:net';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {decodeRequest,encodeAnswer,Incomplete,MAX_MESSAGE_BYTES} from './protocol.mjs';
import {createVendorDeviceLogin} from './vendor-device-login.mjs';
import {validateCurrentRequest} from './current-request.mjs';
import {loadVendorSession} from './vendor-session.mjs';

// Bench-stage bridge. The supplied current-firmware logs establish the exact
// SystemClockInfo response body. Login/menu semantics and all business writes
// still deliberately await device verification.
export function validateConfig(c){
 const url=new URL(c.apiOrigin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('API must be an HTTPS origin');
 if(!net.isIPv4(c.listenHost)||!/^((10\.)|(192\.168\.)|(172\.(1[6-9]|2\d|3[01])\.)|(127\.))/.test(c.listenHost))throw Error('Bind an explicit LAN IPv4 address');
 if(!Number.isInteger(c.port)||c.port<1024||c.port>65535||!Number.isSafeInteger(c.storeId)||c.storeId<1)throw Error('Invalid port/store');
 if(!Array.isArray(c.devices)||!c.devices.length||c.devices.length>100)throw Error('Configure specific devices');
 const ips=new Set(),ids=new Set(),rooms=new Set();
 for(const d of c.devices){if(!net.isIPv4(d.ip)||typeof d.deviceId!=='string'||!d.deviceId||d.deviceId.length>100||typeof d.roomNo!=='string'||!d.roomNo||!Number.isSafeInteger(d.roomId)||d.roomId<1||ips.has(d.ip)||ids.has(d.deviceId)||rooms.has(d.roomId))throw Error('Invalid or duplicate device binding');ips.add(d.ip);ids.add(d.deviceId);rooms.add(d.roomId)}
 return c;
}
export function createCloud(c,token){
 if(!token?.startsWith('gw1.'))throw Error('Independent gateway pairing required; employee and vendor sessions are not accepted');
 const lifetime=new AbortController();
 async function get(path,body){
  const r=await fetch(c.apiOrigin+'/api/hardware/v1'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,headers:{Authorization:'Bearer '+token,'X-Store-ID':String(c.storeId),'Content-Type':'application/json'},signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(5000)]),redirect:'error'});
  if(!r.ok)throw Object.assign(Error('Cloud authorization/service unavailable'),{status:r.status});const json=await r.json();if(json.ok!==true)throw Error('Cloud rejected request');return json.data;
 }
 return {get,close:()=>lifetime.abort()};
}
const roomStatuses=Object.freeze({idle:'空闲',occupied:'占用',cleaning:'待打扫',maintenance:'维修',reserved:'已预订'});
const clockStates=Object.freeze({WAITING:'待派钟',READY:'待上钟',ASSIGNED:'待上钟',PAUSED:'暂停中',IN_SERVICE:'服务中',ENDING_SOON:'即将下钟',OVERTIME:'已超时'});
function clockText(clock){
 if(!Object.hasOwn(clockStates,clock.state))throw Error('Unknown ZA Thera clock state');
 const state=clockStates[clock.state];
 if(!Number.isFinite(clock.remaining_seconds))return state;
 const minutes=Math.max(0,Math.ceil(clock.remaining_seconds/60));
 return clock.remaining_seconds<0?`${state}(${Math.abs(Math.floor(clock.remaining_seconds/60))}分超时)`:state==='服务中'||state==='即将下钟'?`${state}(余${minutes}分)`:state;
}
export function currentClockInfo(snapshot){
 if(!Object.hasOwn(roomStatuses,snapshot?.room?.status))throw Error('Unknown ZA Thera room status');
 const status=roomStatuses[snapshot.room.status];
 if(!Array.isArray(snapshot.clocks)||snapshot.clocks.length>20)throw Error('Invalid ZA Thera clock snapshot');
 return {status,clock:snapshot.clocks.map(clock=>{
  if(!clock||typeof clock!=='object')throw Error('Invalid ZA Thera clock');
  const text=clockText(clock);
  return {t1:String(clock.technician_code??''),t2:String(clock.service_type??''),t3:String(clock.service_name??''),t4:text,t5:text};
 })};
}
export function createHandler(c,cloud,vendor=null){
 return async(request,ip)=>{
  const d=c.devices.find(x=>x.ip===ip&&x.deviceId===request.head.devid&&x.roomNo===request.head.roomid);
  if(!d)return {code:0,msg:'设备未绑定此门店房间',data:null};
  if(request.url==='SystemDeviceLogin'){
   validateCurrentRequest(request);
   if(!vendor)return {code:0,msg:'未检测到完整原厂授权、菜单缓存或门店业态，点钟王登录未启用',data:null};
   const session=await cloud.get('/session');
   if(session.realm!=='hardware'||session.store_id!==c.storeId||session.point_clock_business_type!==vendor.businessType||!session.devices?.some(b=>b.device_id===d.deviceId&&b.device_ip===d.ip&&b.room_id===d.roomId&&b.room_no===d.roomNo))throw Error('Point-clock authorization is no longer valid');
   return createVendorDeviceLogin({deviceId:d.deviceId,roomName:d.roomNo,businessType:vendor.businessType,runtime:vendor.runtime});
  }
  if(request.url!=='SystemClockInfo')return {code:0,msg:'实机联调阶段：此操作尚未开放，请在澜序前台操作',data:null};
  validateCurrentRequest(request);
  // This schema is taken from supplied current-firmware request/response logs.
  // It is strictly read-only and contains no guest or payment information.
  const snapshot=await cloud.get('/rooms/'+encodeURIComponent(d.deviceId));
  return {code:1,msg:'成功',data:currentClockInfo(snapshot)};
 };
}
export function createGateway(c,handler,log=()=>{}){
 const sockets=new Map();
 const failedDevices=new Set();
 function connectionEvent(event,deviceId){
  const connected=[...sockets.values()].some(connection=>connection.deviceId===deviceId&&!connection.rejected);
  const state=connected?'connected':failedDevices.has(deviceId)?'protocol_error':'disconnected';
  log({event,device_id:deviceId,state});
 }
 const server=net.createServer(socket=>{
  const ip=socket.remoteAddress?.replace(/^::ffff:/,'');if(!c.devices.some(d=>d.ip===ip)||sockets.size>=100){socket.destroy();return}
  const deviceId=c.devices.find(d=>d.ip===ip).deviceId;
  const connection={deviceId,rejected:false};sockets.set(socket,connection);failedDevices.delete(deviceId);connectionEvent('device.connected',deviceId);
  socket.setTimeout(15000,()=>socket.destroy());socket.on('error',()=>{});socket.on('close',()=>{sockets.delete(socket);connectionEvent('device.disconnected',deviceId)});let pending=Buffer.alloc(0),running=false;
  async function drain(){
   if(running)return;running=true;
   try{while(pending.length&&!socket.destroyed){let request;try{request=decodeRequest(pending)}catch(e){if(e instanceof Incomplete)break;throw e}pending=pending.subarray(request.consumed);
    // Heartbeats contain no device identity and must not establish authorization.
    // They are still validated as the observed zero-byte body so malformed
    // traffic cannot stay on an authorized device socket indefinitely.
    if(request.url==='HeadBeat'){validateCurrentRequest(request);continue;}
    let result;try{result=await handler(request,ip)}catch{result={code:0,msg:'澜序连接失败或授权已失效，请到前台核对',data:null}}
    log({event:'device.request',interface:request.url,success:result.code===1});
    if(socket.destroyed)break;if(socket.writableLength>MAX_MESSAGE_BYTES)throw Error('Slow receiver');socket.write(encodeAnswer(request,result));
   }}catch{connection.rejected=true;failedDevices.add(deviceId);connectionEvent('device.protocol_rejected',deviceId);socket.destroy()}finally{running=false}
  }
  socket.on('data',b=>{if(pending.length+b.length>MAX_MESSAGE_BYTES){socket.destroy();return}pending=Buffer.concat([pending,b]);void drain()});
 });
 return {server,close:async()=>{for(const s of sockets.keys())s.destroy();await new Promise(resolve=>server.close(resolve))}};
}
async function main(){
 const raw=JSON.parse(await readFile(process.argv[2],'utf8')),c=validateConfig(raw),cloud=createCloud(c,process.env.ZA_THERA_GATEWAY_TOKEN??raw.token);
 const session=await cloud.get('/session');if(session.realm!=='hardware'||session.store_id!==c.storeId)throw Error('Independent store gateway required');
 if(c.devices.some(d=>!session.devices.some(b=>b.device_id===d.deviceId&&b.room_id===d.roomId&&b.room_no===d.roomNo&&b.device_ip===d.ip)))throw Error('Local and authorized device bindings differ');
 const {vendor,message:vendorMessage}=await loadVendorSession(session,c.devices);
 const states=new Map(c.devices.map(d=>[d.deviceId,'disconnected']));let timer;
 const gateway=createGateway(c,createHandler(c,cloud,vendor),v=>{
  if(v.device_id&&v.state)states.set(v.device_id,v.state);
  console.log(JSON.stringify(v));
 });
 const heartbeat=async()=>{try{await cloud.get('/heartbeat',{devices:[...states].map(([device_id,state])=>({device_id,state}))})}catch(e){console.error(JSON.stringify({event:'gateway.cloud_unavailable',authorization_failed:e.status===401||e.status===403}));if([401,403].includes(e.status))await gateway.close()}};
 gateway.server.on('close',()=>{clearInterval(timer);cloud.close()});
 gateway.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port occupied: do not stop the vendor service; choose a separate test port':'Gateway listen failed');process.exitCode=1});
 gateway.server.listen(c.port,c.listenHost,()=>{console.log(JSON.stringify({event:'gateway.listening',mode:'read-only-bench',host:c.listenHost,port:c.port,vendor_login:vendor?'cache-loaded':'disabled',vendor_message:vendorMessage}));void heartbeat();timer=setInterval(()=>void heartbeat(),30000)});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void gateway.close());
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Gateway did not start: verify local configuration and independent merchant authorization');process.exitCode=1});
