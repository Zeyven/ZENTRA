import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import net from 'node:net';
import {once} from 'node:events';
import {decodeRequest,decodeAnswer,encodeRequest,encodeAnswer,Incomplete} from './protocol.mjs';
import {createGateway,createHandler,validateConfig,currentClockInfo} from './bridge.mjs';
const fixture=Buffer.from((await readFile(new URL('./request.fixture.hex',import.meta.url),'utf8')).trim(),'hex');
const config={apiOrigin:'https://saas.zephael.cn',listenHost:'127.0.0.1',port:18032,storeId:1,devices:[{ip:'127.0.0.1',deviceId:'test-device',roomNo:'TEST203',roomId:9}]};
const failures=JSON.parse(await readFile(new URL('./failure-fixtures.json',import.meta.url),'utf8')).responses;

test('failure envelope matches independent Apache Thrift bytes; malformed/oversized results fail closed',()=>{
 const request=decodeRequest(fixture);
 for(const expected of Object.values(failures))assert.deepEqual(encodeAnswer(request,{code:0,msg:expected.message,data:null}),Buffer.from(expected.hex,'hex'));
 for(const result of [{msg:'missing code'},{code:2,msg:'unknown'},null])assert.throws(()=>encodeAnswer(request,result),/Invalid business result/);
 assert.throws(()=>encodeAnswer(request,{code:1,msg:'成功',data:'x'.repeat(256*1024)}),/Message limit/);
});

test('real TCP returns outer failures for unbound and unsupported operations',async()=>{
 let cloudCalls=0;
 const cloud={get:async()=>{cloudCalls++;throw Error('revoked')}};
 for(const kind of ['unbound','unsupported']){
  const c=kind==='unbound'?{...config,devices:[{...config.devices[0],deviceId:'other-device'}]}:config;
  const handler=createHandler(c,cloud);
  const gateway=createGateway(c,(request,ip)=>handler(kind==='unsupported'?{...request,url:'ReportClock'}:request,ip));
  gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
  const socket=net.connect(gateway.server.address().port,'127.0.0.1');
  try{
   await once(socket,'connect');const expected=Buffer.from(failures[kind].hex,'hex');
   const received=await new Promise((resolve,reject)=>{
    const chunks=[];const timer=setTimeout(()=>reject(Error('Missing failure response')),2000);
    const fail=e=>{clearTimeout(timer);reject(e)};socket.once('error',fail);
    socket.on('data',chunk=>{chunks.push(chunk);const bytes=Buffer.concat(chunks);if(bytes.length>=expected.length){clearTimeout(timer);socket.off('error',fail);resolve(bytes)}});
    socket.write(fixture);
   });
   assert.deepEqual(received,expected,kind);
  }finally{socket.destroy();await gateway.close()}
 }
 assert.equal(cloudCalls,0,'unbound and unsupported requests must not reach cloud');
});
test('Apache Thrift fixture: field IDs, negative correlation ID and partial reads',()=>{
 for(let i=0;i<fixture.length;i++)assert.throws(()=>decodeRequest(fixture.subarray(0,i)),Incomplete);
 const r=decodeRequest(fixture);assert.equal(r.type,4);assert.equal(r.url,'SystemClockInfo');assert.equal(r.askId,-42);assert.equal(r.sequence,7);assert.equal(r.head.roomid,'TEST203');assert.equal(r.body.toString(),'null\n');assert.equal(r.consumed,fixture.length);
 const bad=Buffer.from(fixture);bad.writeInt32BE(300000,4);assert.throws(()=>decodeRequest(bad),/Invalid size/);
  const malformed=Buffer.from(fixture);malformed[8]=0xff;assert.throws(()=>decodeRequest(malformed),/Invalid RPC text encoding/);
 const requestReply=Buffer.from(fixture);requestReply[3]=1;assert.throws(()=>decodeRequest(requestReply),/Unsupported RPC method/);
});
test('explicit LAN binding; foreign device and verified SystemClockInfo schema',async()=>{
 validateConfig(config);assert.throws(()=>validateConfig({...config,listenHost:'0.0.0.0'}));assert.throws(()=>validateConfig({...config,apiOrigin:'https://host/?token=secret'}));
 assert.throws(()=>validateConfig({...config,devices:[config.devices[0],{...config.devices[0],ip:'127.0.0.2',deviceId:'other-device',roomNo:'OTHER'}]}),/duplicate device binding/);
 const seen=[];const cloud={get:async path=>{seen.push(path);return {room:{id:9,room_no:'TEST203',status:'cleaning'},clocks:[]}}};
 const handler=createHandler(config,cloud),r=decodeRequest(fixture);
 assert.equal((await handler(r,'127.0.0.2')).code,0);assert.deepEqual(seen,[]);
 assert.equal((await handler({...r,head:{...r.head,roomid:'OTHER'}},'127.0.0.1')).code,0);
 const verified=await handler(r,'127.0.0.1');assert.equal(verified.code,1);assert.deepEqual(verified.data,{status:'待打扫',clock:[]});assert.deepEqual(seen,['/rooms/test-device']);
 assert.equal((await handler({...r,url:'ReportClock'},'127.0.0.1')).code,0);
});
test('SystemClockInfo maps only observed fields from the isolated ZA Thera snapshot',()=>{
 assert.deepEqual(currentClockInfo({room:{status:'occupied'},clocks:[{technician_code:'8',service_type:'点钟',service_name:'项目',state:'IN_SERVICE',remaining_seconds:53*60}]}),{status:'占用',clock:[{t1:'8',t2:'点钟',t3:'项目',t4:'服务中(余53分)',t5:'服务中(余53分)'}]});
 assert.deepEqual(currentClockInfo({room:{status:'maintenance'},clocks:[]}),{status:'维修',clock:[]});
 assert.throws(()=>currentClockInfo({room:{status:'unknown'},clocks:[]}));
 assert.throws(()=>currentClockInfo({room:{status:'toString'},clocks:[]}));
 for(const state of ['unknown','toString',undefined])assert.throws(()=>currentClockInfo({room:{status:'occupied'},clocks:[{state}]}),/Unknown ZA Thera clock state/);
 assert.throws(()=>currentClockInfo({room:{status:'idle'},clocks:[null]}));
});
test('TCP split and coalesced messages; server answer is a separate OnAnsweCall',async()=>{
 let called=0;const result={code:1,msg:'成功',data:{status:'空闲',clock:[]}};
 const gateway=createGateway(config,async()=>{called++;return result});gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
 const socket=net.connect(gateway.server.address().port,'127.0.0.1');try{
  await once(socket,'connect');const chunks=[];const answer=encodeAnswer(decodeRequest(fixture),result);
  const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Missing replies')),2000);socket.on('data',b=>{chunks.push(b);if(Buffer.concat(chunks).length>=2*answer.length){clearTimeout(timer);resolve()}})});
  socket.write(fixture.subarray(0,3));socket.write(Buffer.concat([fixture.subarray(3),fixture]));await done;
  assert.equal(called,2);assert.deepEqual(Buffer.concat(chunks),Buffer.concat([answer,answer]));
  await writeFile(new URL('../../.runtime/hardware-answer.bin',import.meta.url),answer);
 }finally{socket.destroy();await gateway.close()}
});
test('observed heartbeat shape is ignored without authorizing a request; malformed heartbeat closes the socket',async()=>{
 let called=0;const gateway=createGateway(config,async()=>{called++;return {code:1,msg:'成功',data:{}}});gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
 const port=gateway.server.address().port;
 const heartbeat=encodeRequest({url:'HeadBeat',head:{MSG_ID:'2147483647',from_session:'TEST203'},body:Buffer.alloc(0),sequence:20,askId:-2147483647});
 const malformed=encodeRequest({url:'HeadBeat',head:{devid:'test-device',roomid:'TEST203'},body:Buffer.from('{}'),sequence:21,askId:21});
 try{
  const socket=net.connect(port,'127.0.0.1');await once(socket,'connect');
  const answer=await new Promise((resolve,reject)=>{let pending=Buffer.alloc(0);const timer=setTimeout(()=>reject(Error('Missing reply after heartbeat')),2000);socket.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);try{const decoded=decodeAnswer(pending);clearTimeout(timer);resolve(decoded)}catch(e){if(!(e instanceof Incomplete)){clearTimeout(timer);reject(e)}}});socket.write(Buffer.concat([heartbeat,fixture]));});
  assert.equal(answer.askId,-42);assert.equal(called,1);socket.destroy();
  const bad=net.connect(port,'127.0.0.1');await once(bad,'connect');const closed=once(bad,'close');bad.write(malformed);await closed;assert.equal(called,1);bad.destroy();
 }finally{await gateway.close()}
});
test('device state aggregates overlapping TCP connections and recovers after rejection',{timeout:5000},async()=>{
 const events=[];let waiter;
 const gateway=createGateway(config,async()=>({code:1,msg:'成功',data:{}}),event=>{events.push(event);waiter?.(event)});
 const clients=[];
 const next=eventName=>new Promise(resolve=>{waiter=event=>{if(event.event===eventName){waiter=null;resolve(event)}}});
 gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
 const connect=async()=>{const event=next('device.connected');const socket=net.connect(gateway.server.address().port,'127.0.0.1');clients.push(socket);await once(socket,'connect');assert.equal((await event).state,'connected');return socket};
 try{
  const old=await connect(),healthy=await connect();
  let closed=next('device.disconnected');old.destroy();assert.equal((await closed).state,'connected');
  const bad=await connect();const rejected=next('device.protocol_rejected');
  bad.write(Buffer.from('ffffffffffffffff','hex'));assert.equal((await rejected).state,'connected');
  // Wait for the server close event before installing another event observer.
  if(events.at(-1).event!=='device.disconnected')await next('device.disconnected');
  assert.equal(events.at(-1).state,'connected');
  const answer=once(healthy,'data');healthy.write(fixture);assert.equal(decodeAnswer((await answer)[0]).exstatus,0);
  closed=next('device.disconnected');healthy.destroy();assert.equal((await closed).state,'protocol_error');
  const recovered=await connect();closed=next('device.disconnected');recovered.destroy();assert.equal((await closed).state,'disconnected');
  const only=await connect();const soleRejected=next('device.protocol_rejected');only.write(Buffer.from('ffffffffffffffff','hex'));assert.equal((await soleRejected).state,'protocol_error');
 }finally{for(const socket of clients)socket.destroy();await gateway.close()}
});

test('local TCP login uses supplied vendor cache but does not activate clock writes',async()=>{
 const deviceId='0123456789abcdef0123456789abcdef';
 const c={...config,devices:[{...config.devices[0],deviceId}]};
 const runtime={tenantName:'测试门店',servicePhone:'4000000000',registrations:new Map([[deviceId,'authorized-registration-code-000']]),resources:[
  {saasId:'root',parentId:'',title:'FOOT',sortOrder:'1',url:'{}'},
  {saasId:'seven',parentId:'root',title:'7寸点钟王',sortOrder:'1',url:'{}'},
  {saasId:'start',parentId:'seven',title:'报钟',sortOrder:'1',url:'{"funid":"start"}'},
 ]};
 let cloudCalls=0,authorized=true;const cloud={get:async path=>{cloudCalls++;assert.equal(path,'/session');if(!authorized)throw Error('Revoked gateway');return {realm:'hardware',store_id:1,point_clock_business_type:'FOOT',devices:[{device_id:deviceId,device_ip:'127.0.0.1',room_id:9,room_no:'TEST203'}]}}};
 const gateway=createGateway(c,createHandler(c,cloud,{businessType:'FOOT',runtime}));
 gateway.server.listen(0,'127.0.0.1');await once(gateway.server,'listening');
 const socket=net.connect(gateway.server.address().port,'127.0.0.1');
 try{
  await once(socket,'connect');const head={devid:deviceId,roomid:'TEST203'};
  const roundtrip=(url,sequence)=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Missing device reply')),2000);
   let pending=Buffer.alloc(0);const onData=bytes=>{pending=Buffer.concat([pending,bytes]);try{const answer=decodeAnswer(pending);clearTimeout(timer);socket.off('data',onData);resolve(answer)}catch(e){if(!(e instanceof Incomplete)){clearTimeout(timer);socket.off('data',onData);reject(e)}}};
   socket.on('data',onData);socket.write(encodeRequest({url,head,body:Buffer.from('null'),sequence,askId:sequence}));
  });
  const login=await roundtrip('SystemDeviceLogin',11);assert.equal(login.exstatus,0);assert.equal(login.data.data.company,'测试门店');assert.equal(login.data.data.roomname,'TEST203');assert.deepEqual(login.data.data.menu,[{funid:'start'}]);
  const write=await roundtrip('ReportClock',12);assert.equal(write.exstatus,1);assert.match(write.exmsg,/尚未开放/);assert.equal(cloudCalls,1);
  authorized=false;const revoked=await roundtrip('SystemDeviceLogin',13);assert.equal(revoked.exstatus,1);assert.equal(cloudCalls,2);
 }finally{socket.destroy();await gateway.close()}
});
