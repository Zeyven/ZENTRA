import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {clockCount,clockStatus}=createRequire(import.meta.url)('../apps/client/src/renderer/src/utils/clock-room.ts');

test('clock totals accept PostgreSQL numeric strings without concatenation',()=>{
  assert.equal(['2','3.5',0,null].reduce<number>((sum,value)=>sum+clockCount(value),0),5.5);
  for(const value of [undefined,{},'bad',Infinity,-1])assert.equal(clockCount(value),0);
});
test('resting and serving technicians cannot be presented as waiting or off duty',()=>{
  assert.equal(clockStatus('rest').label,'休息中');
  assert.equal(clockStatus('serving').label,'上钟中');
  assert.equal(clockStatus('serving','ASSIGNED').label,'待接单');
  assert.equal(clockStatus('serving','PAUSED').label,'服务暂停');
  assert.equal(clockStatus('on').label,'等待排钟');
  assert.equal(clockStatus('unexpected').label,'状态待确认');
});
