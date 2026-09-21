import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startSimulator} from './simulator.mjs';
import {encodeRequest,decodeRequest,decodeAnswer,Incomplete} from './protocol.mjs';
test('virtual panel codec matches independent Apache fixtures',async()=>{
 const request=Buffer.from((await readFile(new URL('./request.fixture.hex',import.meta.url),'utf8')).trim(),'hex');
 assert.deepEqual(encodeRequest(decodeRequest(request)),request);
 const fixtures=JSON.parse(await readFile(new URL('./failure-fixtures.json',import.meta.url),'utf8'));
 for(const f of Object.values(fixtures.responses)){
  const bytes=Buffer.from(f.hex,'hex');for(let i=0;i<bytes.length;i++)assert.throws(()=>decodeAnswer(bytes.subarray(0,i)),Incomplete);
  const answer=decodeAnswer(bytes);assert.equal(answer.exstatus,1);assert.equal(answer.exmsg,f.message);assert.equal(answer.askId,-42);assert.equal(answer.sequence,7);
 }
});
test('simulator HTTP to TCP: verified refusals, isolated failures and origin check',async()=>{
 const sim=await startSimulator(0),origin=`http://127.0.0.1:${sim.port}`;
 try{
  const page=await (await fetch(origin)).text();
  assert.match(page,/本机模拟/);
  assert.match(page,/不提供模拟房态、技师或订单数据/);
  assert.doesNotMatch(page,/预置演示状态/);
  const send=(action,scenario='normal',source=origin)=>fetch(origin+'/simulate',{method:'POST',headers:{Origin:source,'Content-Type':'application/json'},body:JSON.stringify({action,scenario})});
  const read=await(await send('SystemClockInfo')).json();assert.equal(read.mode,'local-synthetic');assert.equal(read.answer.exstatus,1);
  for(const action of ['SystemDeviceLogin','SystemUserLogin','ReportClock','AddClock','CloseClock'])assert.equal((await(await send(action)).json()).answer.exstatus,1);
  for(const scenario of ['unbound','cloud_failure'])assert.equal((await(await send('SystemClockInfo',scenario)).json()).answer.exstatus,1);
  assert.equal((await send('SystemClockInfo','normal','https://example.com')).status,403);
  assert.equal((await send('Unknown')).status,400);
 }finally{await sim.close()}
});
