import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {harness} from './helpers.js';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';

test('restoration blocks only its merchant and waiting requests recheck revoked credentials after the transaction',async()=>{
 const h=await harness();let release!:()=>void;
 try{
  const a=await h.onboard(),b=await h.onboard();
  let locked!:()=>void;const entered=new Promise<void>(r=>{locked=r}),gate=new Promise<void>(r=>{release=r});
  const restore=inTenant(a.merchant.id,async()=>{await tenantQuery("SELECT pg_advisory_xact_lock(hashtextextended($1||':restore',0))",[a.merchant.id]);locked();await gate;await tenantQuery('UPDATE merchant_sessions SET revoked_at=now()')});
  await entered;let done=false;const waiting=h.api(a.token,a.stores[0].id,'/members').then(r=>{done=true;return r});
  const other=await h.api(b.token,b.stores[0].id,'/members');assert.equal(other.status,200);await delay(150);assert.equal(done,false);
  release();await restore;assert.equal((await waiting).status,401);
 }finally{release?.();await h.stop()}
});
