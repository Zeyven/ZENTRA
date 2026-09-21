import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {io,Socket} from 'socket.io-client';
import {harness,succeeded,password} from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,employee:any,sa:Socket,sb:Socket,se:Socket;const sockets:Socket[]=[];
function wait(socket:Socket,event:string,ms=10000){return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(event,listener);reject(Error('Timed out waiting for '+event))},ms);function listener(value:any){clearTimeout(timer);resolve(value)}socket.once(event,listener)})}
async function connect(token:string,store:number){const socket=io(h.origin,{autoConnect:false,reconnection:false,transports:['websocket'],auth:{token,store_id:store,protocol_version:1}});sockets.push(socket);const ready=wait(socket,'connect');socket.connect();await ready;return socket}
before(async()=>{
 h=await harness({realtime:true});a=await h.onboard();b=await h.onboard();
 employee=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'multi-store',password,name:'多店员工'}));
 succeeded(await h.api(a.token,undefined,`/users/${employee.id}/grants`,'PUT',{grants:a.stores.map((s:any)=>({store_id:s.id,role:'manager'}))}));
 employee.token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'multi-store',password})).token;
 sa=await connect(a.token,a.stores[0].id);sb=await connect(b.token,b.stores[0].id);se=await connect(employee.token,a.stores[0].id);
});
after(async()=>{for(const socket of sockets)socket.disconnect();if(h)await h.stop()});
test('only merchant sessions may connect and a foreign store cannot be subscribed',async()=>{
 for(const [token,store] of [[h.platformToken,a.stores[0].id],[a.token,b.stores[0].id]] as [string,number][]){const socket=io(h.origin,{autoConnect:false,reconnection:false,transports:['websocket'],auth:{token,store_id:store,protocol_version:1}});sockets.push(socket);const failed=wait(socket,'connect_error');socket.connect();assert.match((await failed).message,/认证失败/);assert.equal(socket.connected,false)}
});
test('durable invalidations stay within the merchant; event cursor cannot expose foreign stores',async()=>{
 const bEvents:any[]=[];sb.on('data.changed',value=>bEvents.push(value));const received=wait(sa,'data.changed');
 succeeded(await h.api(a.token,a.stores[0].id,'/rooms','POST',{room_no:'101'}));const changed=await received;assert.equal(changed.merchant_id,a.merchant.id);assert.equal(changed.store_id,a.stores[0].id);assert(changed.id>0);
 assert(bEvents.every(e=>e.merchant_id===b.merchant.id));
 const events=succeeded(await h.api(a.token,a.stores[0].id,'/realtime/events?after=0'));assert(events.items.some((e:any)=>e.topic==='rooms.changed'));assert(events.items.every((e:any)=>e.store_id===null||e.store_id===a.stores[0].id));
 assert.equal((await h.api(a.token,b.stores[0].id,'/realtime/events?after=0')).status,403);
});
test('revoking one store disconnects its active socket and preserves other merchant sessions',async()=>{
 const disconnected=wait(se,'disconnect');succeeded(await h.api(a.token,undefined,`/users/${employee.id}/grants`,'PUT',{grants:[{store_id:a.stores[1].id,role:'manager'}]}));await disconnected;
 assert.equal(se.connected,false);assert.equal(sa.connected,true);assert.equal(sb.connected,true);
 const allowed=await connect(employee.token,a.stores[1].id);assert.equal(allowed.connected,true);
});
test('support revocation terminates an active support socket immediately',async()=>{
 const operator=succeeded(await h.api(a.token,undefined,'/support/operators')).items.find((row:any)=>row.id===h.platformUserId);
 assert(operator);const grant=succeeded(await h.api(a.token,undefined,'/support/grants','POST',{platform_user_id:operator.id,scope:'read'}));
 const session=succeeded(await h.call(`/api/platform/v1/support-grants/${grant.id}/session`,'POST',{},h.platformToken));
 const support=await connect(session.token,a.stores[0].id);const disconnected=wait(support,'disconnect');succeeded(await h.api(a.token,undefined,`/support/grants/${grant.id}`,'DELETE'));await disconnected;assert.equal(support.connected,false);assert.equal(sa.connected,true);
});
