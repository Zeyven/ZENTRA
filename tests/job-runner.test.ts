import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startClockJobs} from '../apps/server/src/jobs.js';
import {closePools} from '../apps/server/src/db/pools.js';
import {after} from 'node:test';
after(closePools);

test('one failed tenant cannot starve the remainder; readiness recovers only after a successful subsequent sweep',async()=>{
 const ids=Array.from({length:25},(_,i)=>String(i).padStart(2,'0')),seen:string[]=[];let fail=true;
 const runner=startClockJobs({list:async cursor=>ids.filter(id=>!cursor||id>cursor).slice(0,20).map(id=>({id})),scan:async id=>{seen.push(id);if(id==='01'&&fail)throw Object.assign(Error('injected tenant failure'),{code:'TEST_FAILURE'})}});
 try{await runner.run();assert.deepEqual(seen,ids.slice(0,20));assert.equal(runner.healthy(),false);assert.equal(runner.status().failed_merchants,1);
 await runner.run();assert.deepEqual(seen,ids);assert.equal(runner.healthy(),false);
 fail=false;await runner.run();await runner.run();assert.deepEqual(seen,[...ids,...ids]);assert.equal(runner.healthy(),true);assert.equal(runner.status().failed_merchants,0);
 }finally{await runner.close()}
 const count=seen.length;await runner.run();assert.equal(seen.length,count);
});

test('overlapping ticks share one run; close waits for active work and does not start another tenant',async()=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve}),seen:string[]=[];
 const runner=startClockJobs({list:async()=>[{id:'a'},{id:'b'}],scan:async id=>{seen.push(id);await pending}});
 await Promise.resolve();const first=runner.run(),second=runner.run();assert.equal(first,second);
 const closing=runner.close();release();await closing;assert.deepEqual(seen,['a']);
});
