import {test,after} from 'node:test';import assert from 'node:assert/strict';import {harness,succeeded,password} from './helpers.js';import {io} from 'socket.io-client';
let h:Awaited<ReturnType<typeof harness>>;after(async()=>{if(h)await h.stop()});
test('same-role employees have separate pages and actions per store; revocation affects API and socket',async()=>{
 h=await harness({realtime:true});const a=await h.onboard(),b=await h.onboard(),s=a.stores[0].id,t=a.stores[1].id;
 const owner=(path:string,method='GET',body?:any)=>h.api(a.token,undefined,path,method,body);
 const u=succeeded(await owner('/users','POST',{username:'limited',name:'限定店长',password})),v=succeeded(await owner('/users','POST',{username:'peer',name:'其他店长',password}));
 const grant=(pages:string[],actions:string[])=>owner('/users/'+u.id+'/grants','PUT',{grants:[{store_id:s,role:'manager',pages,actions},{store_id:t,role:'manager',pages:['members'],actions:['recharge']}]});
 succeeded(await grant(['board','members'],[]));succeeded(await owner('/users/'+v.id+'/grants','PUT',{grants:[{store_id:s,role:'manager'}]}));
 const login=async(username:string)=>succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username,password})).token;
 const token=await login('limited'),peer=await login('peer');
 assert(succeeded(await h.api(peer,s,'/permissions/self')).pages.manager.includes('settings'));
 succeeded(await h.api(peer,s,'/settings','POST',{store_address:'店长维护地址'}));
 assert.equal(succeeded(await h.api(peer,s,'/settings')).store_address,'店长维护地址');
 assert.equal((await h.api(peer,t,'/settings','POST',{store_address:'未授权门店'})).status,403);
 assert.equal((await h.api(peer,b.stores[0].id,'/settings','POST',{store_address:'跨商家'})).status,403);
 assert.equal((await h.api(peer,s,'/permissions','PUT',{pages:{},actions:{}})).status,403);
 assert.equal((await h.api(token,s,'/settings','POST',{store_address:'未授权模块'})).status,403);
 succeeded(await owner('/users/'+u.id+'/grants','PUT',{grants:[{store_id:s,role:'manager',pages:['board','members','settings'],actions:[]}]}));
 succeeded(await h.api(token,s,'/settings','POST',{store_phone:'12345678'}));
 succeeded(await grant(['board','members'],[]));
 assert.equal((await h.api(token,s,'/settings')).status,403);
 succeeded(await owner('/users/'+u.id+'/grants','PUT',{grants:[{store_id:s,role:'manager'},{store_id:t,role:'manager'}]})); // Older clients cannot silently clear personal restrictions.

 const self=succeeded(await h.api(token,s,'/permissions/self'));assert.deepEqual(self.pages.manager,['board','members']);assert.deepEqual(self.actions.manager,[]);
 assert.equal((await h.api(token,s,'/reports/daily')).status,403);succeeded(await h.api(peer,s,'/reports/daily'));
 const member=succeeded(await h.api(a.token,s,'/members','POST',{name:'权限会员'}));
 assert.equal((await h.api(token,s,'/members/recharge','POST',{customer_id:member.id,amount:10,method:'现金'})).status,403);
 succeeded(await h.api(token,t,'/members/recharge','POST',{customer_id:member.id,amount:10,method:'现金'}));
 assert.equal((await h.api(b.token,undefined,'/users/'+u.id+'/grants','PUT',{grants:[]})).status,404);
 assert.equal((await grant(['organization'],[])).status,400);assert.equal((await grant(['board'],['userManage'])).status,400);
 assert.deepEqual(succeeded(await h.api(token,s,'/permissions/self')).actions.manager,[]);
 const socket=io(h.origin,{autoConnect:false,reconnection:false,transports:['websocket'],auth:{token,store_id:s,protocol_version:1}});
 try{await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect()});const disconnected=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket remained connected')),10000);socket.once('disconnect',()=>{clearTimeout(timer);resolve()})});succeeded(await grant([],[]));await disconnected;assert.equal((await h.api(token,s,'/snapshot')).status,403);succeeded(await h.api(peer,s,'/snapshot'));succeeded(await h.api(token,t,'/members'))}finally{socket.disconnect()}
});
test('explicit employee actions can be granted individually, but store role prohibitions remain ceilings',async()=>{
 const a=await h.onboard(),s=a.stores[0].id;const u=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'asset',name:'资产员工',password}));
 succeeded(await h.api(a.token,undefined,'/users/'+u.id+'/grants','PUT',{grants:[{store_id:s,role:'manager',pages:['members'],actions:['adjust']}]}));
 const token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'asset',password})).token;
 assert.deepEqual(succeeded(await h.api(token,s,'/permissions/self')).actions.manager,['adjust']);
 succeeded(await h.api(a.token,s,'/permissions','PUT',{pages:{manager:['members']},actions:{manager:[]}}));assert.deepEqual(succeeded(await h.api(token,s,'/permissions/self')).actions.manager,[]);
});
