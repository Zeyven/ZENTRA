import {createCloud,createGateway,createHandler,validateConfig} from './bridge.mjs';
import net from 'node:net';
import {loadVendorSession} from './vendor-session.mjs';

// Managed, memory-only read-only bridge. The host application supplies the fixed API origin.
export function createGatewayController(apiOrigin,{allowTestLoopback=false,loadVendor=loadVendorSession}={}){
 const origin=new URL(apiOrigin);
 if(origin.origin!==apiOrigin||origin.username||origin.password||!(origin.protocol==='https:'||(allowTestLoopback&&origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname))))throw Error('Invalid fixed gateway API origin');
 let generation=0,starting=false,active=null,timer=null,pendingCloud=null;
 let state={status:'stopped',message:'本机网关未启动'};
 const snapshot=()=>({...state,devices:active?[...active.states].map(([device_id,state])=>({device_id,state})):[]});
 async function stop(message='本机网关已停止'){
  generation++;clearTimeout(timer);timer=null;const old=active;active=null;state={status:'stopped',message};
  pendingCloud?.close();old?.cloud.close();
  if(old)await old.gateway.close();return snapshot();
 }
 async function check(){
  const run=active;if(!run||run.checking)return snapshot();run.checking=true;
  try{
   await run.cloud.get('/heartbeat',{devices:[...run.states].map(([device_id,state])=>({device_id,state}))});
   if(active===run)state={...state,status:'running',message:'网关正在监听'+(run.vendorMessage??'')+'；报钟等写操作仍待实机验收'};
  }catch(e){if(active===run){if([401,403].includes(e.status))await stop('授权已失效，网关已停止');else state={...state,status:'degraded',message:'云端暂不可达，设备查询将返回失败，请检查网络'};}}
  finally{run.checking=false;if(active===run){clearTimeout(timer);timer=setTimeout(()=>void check(),15000);timer.unref?.()}}
  return snapshot();
 }
 async function start(input){
  if(starting||active)throw Error('已有网关正在启动或运行，请先停止后再配置');
  if(!input||input.apiOrigin!==apiOrigin||typeof input.token!=='string'||!/^gw1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.[\w-]{43}$/i.test(input.token))throw Error('需要本系统签发的独立门店网关授权');
  const c={apiOrigin,listenHost:input.listenHost,port:input.port,storeId:input.storeId,devices:input.devices?.map(d=>({ip:d.ip,deviceId:d.deviceId,roomNo:d.roomNo,roomId:d.roomId}))};
  validateConfig({...c,apiOrigin:'https://validation.invalid'});
  if(c.devices.some(d=>!net.isIPv4(d.ip)))throw Error('设备IP无效');
  const current=++generation;starting=true;state={status:'starting',message:'正在验证门店授权并启动只读网关'};
  try{
   const cloud=createCloud(c,input.token);pendingCloud=cloud;
   const session=await cloud.get('/session');
   if(generation!==current)return snapshot();
   if(session.realm!=='hardware'||session.store_id!==c.storeId||c.devices.length!==session.devices?.length||c.devices.some(d=>!session.devices.some(b=>b.device_id===d.deviceId&&b.device_ip===d.ip&&b.room_id===d.roomId&&b.room_no===d.roomNo)))throw Error('本机绑定与云端授权不一致，请重新配对');
   const {vendor,message:vendorMessage}=await loadVendor(session,c.devices);
   if(generation!==current)return snapshot();
   const states=new Map(c.devices.map(d=>[d.deviceId,'disconnected']));
   const gateway=createGateway(c,createHandler(c,cloud,vendor),event=>{
    if(event.device_id&&event.state)states.set(event.device_id,event.state);
   });
   const run={gateway,cloud,states,checking:false,vendorMessage};active=run;
   gateway.server.on('error',()=>{if(active===run&&state.status!=='starting')void stop('监听发生错误，网关已停止，请检查本机地址和端口')});
   await new Promise((resolve,reject)=>{
    const server=gateway.server;
    const cleanup=()=>{server.off('error',failed);server.off('close',closed);server.off('listening',listening)};
    const failed=error=>{cleanup();reject(error)},closed=()=>failed(Error('Gateway startup cancelled')),listening=()=>{cleanup();resolve()};
    server.once('error',failed);server.once('close',closed);server.once('listening',listening);server.listen(c.port,c.listenHost);
   });
   if(generation!==current){await gateway.close();return snapshot()}
   state={status:'running',storeId:c.storeId,host:c.listenHost,port:c.port,message:'网关正在监听'+vendorMessage+'；报钟等写操作仍待实机验收'};
   await check();return snapshot();
  }catch(e){if(generation===current){await stop('网关启动失败，未更改原厂服务');throw Error(e.code==='EADDRINUSE'?'端口被占用，请选其他端口':e.message?.includes('绑定')?e.message:'网关启动失败，请核对本机IP、端口及有效授权')}return snapshot()}
  finally{pendingCloud=null;starting=false}
 }
 return {start,stop,check,state:snapshot};
}
