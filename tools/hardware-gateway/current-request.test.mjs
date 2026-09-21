import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCurrentRequest,MAX_BODY_BYTES} from './current-request.mjs';

const request=(url,value)=>({url,body:Buffer.from(JSON.stringify(value))});

test('validates observed current point-clock request bodies',()=>{
 assert.equal(validateCurrentRequest(request('SystemDeviceLogin',null)),null);
 assert.deepEqual(validateCurrentRequest(request('SystemUserLogin',{id:'T001'})),{id:'T001'});
 assert.equal(validateCurrentRequest({url:'HeadBeat',body:Buffer.alloc(0)}),null);
 assert.equal(validateCurrentRequest(request('ReportClock',[{pgid:'p',funid:'f',data:{array:[JSON.stringify({bh:'T001',mc:'项目'})]}}])).length,1);
 assert.equal(validateCurrentRequest(request('CloseClock',[{pgid:'p',funid:'f',data:null}])).length,1);
 assert.equal(validateCurrentRequest(request('AddClock',[{pgid:'p1',funid:'f1',data:{bh:'A'}},{pgid:'p2',funid:'f2',data:null}])).length,2);
});

test('rejects malformed, expanded and unsupported point-clock requests',()=>{
 for(const input of [
  request('SystemClockInfo',{}),
  request('SystemUserLogin',{id:'T001',role:'owner'}),
  request('HeadBeat',{}),
  request('HeadBeat','2026-09-15 17:00:00'),
  request('HeadBeat',''),
  {url:'HeadBeat',body:''},
  request('ReportClock',[{pgid:'p',funid:'f',data:[]}]),
  request('ReportClock',[{pgid:'p',funid:'f',data:{array:[JSON.stringify({bh:'T001',mc:'项目',role:'owner'})]}}]),
  request('CloseClock',[{pgid:'p',funid:'f',data:{}}]),
  request('Unknown',null),
 ])assert.throws(()=>validateCurrentRequest(input));
 assert.throws(()=>validateCurrentRequest({url:'SystemClockInfo',body:Buffer.alloc(MAX_BODY_BYTES+1)}));
 assert.throws(()=>validateCurrentRequest({url:'SystemUserLogin',body:Buffer.concat([Buffer.from('{"id":"'),Buffer.from([0xff]),Buffer.from('"}')])}),/Invalid point-clock JSON/);
});
