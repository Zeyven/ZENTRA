import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createGateway,createHandler} from './bridge.mjs';
import {encodeRequest,decodeAnswer,Incomplete,MAX_MESSAGE_BYTES} from './protocol.mjs';

const actions=new Set(['SystemClockInfo','SystemDeviceLogin','SystemUserLogin','ReportClock','AddClock','CloseClock']);
const cases=new Set(['normal','unbound','cloud_failure']);
export async function startSimulator(port=18033){
 const config={devices:[{ip:'127.0.0.1',deviceId:'virtual-panel',roomNo:'SIM203',roomId:203}]};
 const gateway=createGateway(config,async(request,ip)=>{
  // No cloud client, merchant credentials or production writes. A synthetic
  // room response would conceal the fact that the real firmware response
  // schema has not been verified, so all actions exercise refusal handling.
  const cloud={get:async()=>{
   if(request.head.sim_case==='cloud_failure')throw Error('Synthetic cloud failure');
   return {room:{id:203,room_no:'SIM203'},clocks:[]};
  }};
  return createHandler(config,cloud)(request,ip);
 });
 gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
 const tcpPort=gateway.server.address().port;let serial=0;const connections=new Set();
 async function exchange(action,scenario){
  const id=++serial;
  const packet=encodeRequest({url:action,head:{devid:scenario==='unbound'?'unknown-panel':'virtual-panel',roomid:'SIM203',MSG_ID:String(id),sim_case:scenario},body:Buffer.from('null'),sequence:id,askId:id});
  return new Promise((resolve,reject)=>{
   const socket=net.connect(tcpPort,'127.0.0.1');connections.add(socket);let pending=Buffer.alloc(0),finished=false;
   const timer=setTimeout(()=>finish(Error('设备应答超时')),4000);
   function finish(error,result){if(finished)return;finished=true;clearTimeout(timer);connections.delete(socket);socket.destroy();error?reject(error):resolve(result)}
   socket.on('error',e=>finish(e));socket.on('close',()=>finish(Error('连接提前关闭')));
   socket.on('connect',()=>socket.write(packet));
   socket.on('data',chunk=>{try{
    if(pending.length+chunk.length>MAX_MESSAGE_BYTES)throw Error('应答超长');pending=Buffer.concat([pending,chunk]);
    const answer=decodeAnswer(pending);if(answer.askId!==id||answer.sequence!==id||answer.consumed!==pending.length)throw Error('应答关联不匹配');
    finish(null,{action,scenario,mode:'local-synthetic',tcpPort,sentBytes:packet.length,receivedBytes:pending.length,answer});
   }catch(e){if(!(e instanceof Incomplete))finish(e)}});
  });
 }
 const page=await readFile(new URL('./simulator.html',import.meta.url));
 const server=http.createServer(async(req,res)=>{
  const expectedHost=`127.0.0.1:${server.address().port}`;
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  if(req.headers.host!==expectedHost){res.writeHead(403).end();return}
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);return}
  if(req.method!=='POST'||req.url!=='/simulate'){res.writeHead(404).end();return}
  if(req.headers.origin!==`http://${expectedHost}`||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(403).end();return}
  try{
   let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('请求过长')}
   const input=JSON.parse(body);if(!actions.has(input.action)||!cases.has(input.scenario))throw Error('不支持的测试场景');
   const result=await exchange(input.action,input.scenario);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch{res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:'测试未完成，请核对操作或重新连接'}))}
 });
 server.on('error',()=>void gateway.close());server.listen(port,'127.0.0.1');await once(server,'listening');
 return {port:server.address().port,close:async()=>{for(const socket of connections)socket.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));await gateway.close()}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const sim=await startSimulator();console.log(`虚拟点钟王：http://127.0.0.1:${sim.port}（仅模拟数据）`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void sim.close());
}
