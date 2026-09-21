import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {harness,succeeded,password} from './helpers.js';
import {io,Socket} from 'socket.io-client';
import {defaultPages,defaultActions} from '@za-spa/contracts';
import {inTenant,tenantQuery} from '../apps/server/src/db/pools.js';
let h:Awaited<ReturnType<typeof harness>>,a:any,b:any,staff:any,member:any,room:any;const sockets:Socket[]=[];
const api=(path:string,method='GET',body?:any,token=a.token,store=a.stores[0].id)=>h.api(token,store,path,method,body);
before(async()=>{h=await harness({realtime:true});a=await h.onboard();b=await h.onboard();staff=succeeded(await api('/users','POST',{username:'configured-manager',password,name:'指定模块店长'}));succeeded(await api('/users/'+staff.id+'/grants','PUT',{grants:a.stores.map((s:any)=>({store_id:s.id,role:'manager'}))}));staff.token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'configured-manager',password})).token;member=succeeded(await api('/members','POST',{name:'限定查询客户',phone:'13900000000',tags:'内部标签'}));room=succeeded(await api('/rooms','POST',{room_no:'ACL'}))});
after(async()=>{sockets.forEach(s=>s.disconnect());await h.stop()});
async function configure(pages:string[]){return succeeded(await api('/permissions','PUT',{pages:{manager:pages},actions:{manager:defaultActions.manager}}))}
test('revoked management modules reject API reads and writes while explicit cashier lookup still works and cannot enumerate a directory',async()=>{
 await configure(['board','orders']);
 for(const path of ['/members','/members/'+member.id,'/reports/daily','/inventory/overview','/shifts','/approvals','/reservations','/queue','/catalog/templates'])assert.equal((await api(path,'GET',undefined,staff.token)).status,403,path);
 assert.equal((await api('/members','POST',{name:'绕过菜单'},staff.token)).status,403);
 assert.equal((await api('/members/recharge','POST',{customer_id:member.id,amount:50,method:'现金'},staff.token)).status,403);
 const search=succeeded(await api('/members/search?keyword='+encodeURIComponent('限定查询'),'GET',undefined,staff.token));assert.equal(search.length,1);assert.equal(search[0].id,member.id);assert(!('tags' in search[0]));
 assert.equal((await api('/members/search?keyword=','GET',undefined,staff.token)).status,400);assert.deepEqual(succeeded(await api('/members/search?keyword=%25','GET',undefined,staff.token)),[]);
 assert.deepEqual(succeeded(await api('/snapshot','GET',undefined,staff.token)).members,[]);
 succeeded(await api('/sessions','POST',{resource_id:room.id,customer_id:member.id},staff.token));
 succeeded(await api('/members','GET',undefined,staff.token,a.stores[1].id));
 const other=succeeded(await h.api(b.token,b.stores[0].id,'/permissions/self'));assert(other.pages.owner.includes('members'));
 await configure(defaultPages.manager);succeeded(await api('/members','GET',undefined,staff.token));
});
test('removing every page revokes an already-connected socket immediately, filtered cursors exclude disabled domains, and another store remains available',async()=>{
 await configure(['queue']);
 const socket=io(h.origin,{autoConnect:false,reconnection:false,transports:['websocket'],auth:{token:staff.token,store_id:a.stores[0].id,protocol_version:1}});sockets.push(socket);
 await new Promise<void>((resolve,reject)=>{socket.once('connect',()=>resolve());socket.once('connect_error',reject);socket.connect()});
 succeeded(await api('/members','POST',{name:'隐藏会员事件'}));succeeded(await api('/queue/take','POST',{customer_name:'排队客户',people:1}));
 const events=succeeded(await api('/realtime/events?after=0','GET',undefined,staff.token));assert(events.items.some((r:any)=>r.topic==='queue.changed'));assert(events.items.every((r:any)=>!r.topic.startsWith('member')));
 const disconnected=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Revoked socket remained connected')),10000);socket.once('disconnect',()=>{clearTimeout(timeout);resolve()})});
 await configure([]);await disconnected;assert.equal(socket.connected,false);assert.equal((await api('/queue','GET',undefined,staff.token)).status,403);succeeded(await api('/queue','GET',undefined,staff.token,a.stores[1].id));
});
test('technician snapshots expose only their own service amount and never the whole room subtotal',async()=>{
 const tech=succeeded(await api('/technicians','POST',{name:'本人技师',code:'ACL-TECH'}));succeeded(await api('/technicians/'+tech.id+'/clock','POST',{status:'on'}));
 const user=succeeded(await api('/users','POST',{username:'own-clock',password,name:'本人账号'}));succeeded(await api('/users/'+user.id+'/grants','PUT',{grants:[{store_id:a.stores[0].id,role:'technician',technician_id:tech.id}]}));
 const token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'own-clock',password})).token;
 const ownRoom=succeeded(await api('/rooms','POST',{room_no:'TECH-SCOPE'})),service=succeeded(await api('/items','POST',{name:'本人服务',type:'service',price:80,duration:60})),product=succeeded(await api('/items','POST',{name:'顾客额外商品',type:'product',price:500}));let order=succeeded(await api('/sessions','POST',{resource_id:ownRoom.id,guest_name:'隐私客户'}));order=succeeded(await api('/sessions/'+order.id+'/items','POST',{catalog_id:service.id,technician_id:tech.id,version:order.version}));order=succeeded(await api('/sessions/'+order.id+'/items','POST',{catalog_id:product.id,version:order.version}));assert.equal(order.order.subtotal,580);
 const snapshot=succeeded(await api('/snapshot','GET',undefined,token));assert.equal(snapshot.resources.length,1);assert.equal(snapshot.resources[0].total,80);assert.equal(snapshot.resources[0].guest_name,null);assert.equal(snapshot.resources[0].items.length,1);assert.equal(snapshot.technicians.length,1);assert.deepEqual(snapshot.members,[]);
});
test('configuration support may maintain settings but cannot raise the grant scope or execute business money operations',async()=>{
 const operator=succeeded(await api('/support/operators')).items.find((row:any)=>row.id===h.platformUserId);assert(operator);const grant=succeeded(await api('/support/grants','POST',{platform_user_id:operator.id,scope:'configuration'}));const session=succeeded(await h.call('/api/platform/v1/support-grants/'+grant.id+'/session','POST',{},h.platformToken));
 succeeded(await api('/settings','POST',{store_address:'授权配置维护'},session.token));assert.equal((await api('/members/recharge','POST',{customer_id:member.id,amount:100,method:'现金'},session.token)).status,403);
 const logs=await inTenant(a.merchant.id,async()=>(await tenantQuery("SELECT platform_user_id,user_id FROM audit_events WHERE action='settings.updated'")).rows);assert(logs.some(r=>r.platform_user_id===operator.id&&r.user_id===null));
 succeeded(await api('/support/grants/'+grant.id,'DELETE'));assert.equal((await api('/settings','POST',{store_address:'已撤销'},session.token)).status,403);
});
