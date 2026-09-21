import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createApp} from '../apps/server/src/app.js';
import {closePools} from '../apps/server/src/db/pools.js';

test('malformed JSON and oversized requests return safe client errors before authentication',async()=>{
 const server=createServer(createApp());server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const url=`http://127.0.0.1:${(server.address() as any).port}/api/merchant/v1/auth/login`;
  for(const [body,status,code] of [['{"password":"private-value",',400,'INVALID_JSON'],[JSON.stringify({password:'x'.repeat(270000)}),413,'REQUEST_TOO_LARGE']] as const){
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body});
   assert.equal(response.status,status);const payload=await response.json() as any;
   assert.equal(payload.code,code);assert.equal(payload.ok,false);assert.ok(!JSON.stringify(payload).includes('private-value'));
  }
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await closePools()}
});
