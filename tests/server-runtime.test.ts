import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

test('compiled Node service starts without tsx, runs real database jobs and exposes readiness', {timeout:60000},async()=>{
 assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/za_spa_saas_test');
 const child=spawn(process.execPath,[resolve('apps/server/dist/index.js')],{env:{...process.env,PORT:'0',SAAS_TEST_JOBS:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 let port:number|undefined,output='',errors='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',data=>{output+=data;for(const line of output.split('\n')){try{const entry=JSON.parse(line);if(entry.event==='server.started')port=entry.port}catch{}}});child.stderr.on('data',data=>{errors+=data});
 const exited=new Promise<number|null>(resolve=>child.once('exit',resolve));
 try{
  const deadline=Date.now()+45000;let ready:any;
  while(Date.now()<deadline){
   assert.equal(child.exitCode,null,'compiled service exited: '+errors);
   if(port){const response=await fetch('http://127.0.0.1:'+port+'/ready');ready=await response.json();if(response.ok&&ready.jobs?.last_success_at)break}
   await delay(100);
  }
  assert(port);assert.equal(ready?.ok,true);assert.equal(ready.service,'za-spa-saas');assert.equal(ready.jobs.failed_merchants,0);assert.equal(ready.jobs.error,null);assert.match(ready.jobs.last_success_at,/^\d{4}-/);
  const denied=await fetch('http://127.0.0.1:'+port+'/api/merchant/v1/members');assert.equal(denied.status,401);
 }finally{child.kill('SIGTERM');await exited}
});
