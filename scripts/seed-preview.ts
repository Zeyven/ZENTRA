import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {harness,succeeded} from '../tests/helpers.js';
assert(!existsSync('.runtime/preview-account.json'),'Preview account already exists; do not replace its data');
const h=await harness();
try{
 const code='LANXU-TEST',username='owner',password='Thera-'+randomBytes(12).toString('base64url')+'!';
 const created=succeeded(await h.call('/api/platform/v1/merchants','POST',{code,name:'澜序体验商家（测试）',member_mode:'merchant'},h.platformToken));
 succeeded(await h.call('/api/merchant/v1/auth/activate','POST',{token:created.invite.token,username,password,name:'体验老板'}));
 const auth=succeeded(await h.call('/api/merchant/v1/auth/login','POST',{merchant_code:code,username,password}));
 const api=async(path:string,body?:unknown,store?:number,method='POST')=>succeeded(await h.api(auth.token,store,path,method,body));
 const store=await api('/stores',{code:'001',name:'澜序会馆 · 江畔店'}),second=await api('/stores',{code:'002',name:'澜序会馆 · 城南店'});
 // Save credentials before creating optional preview content, so a failed seed never loses the account.
 await writeFile('.runtime/preview-account.json',JSON.stringify({merchant_code:code,username,password,merchant_id:created.merchant.id,store_id:store.id,url:'http://127.0.0.1:5178'},null,2));
 await writeFile('.runtime/测试版登录信息.txt',`ZA Thera｜澜序 — 隔离测试预览\n地址：http://127.0.0.1:5178\n商家编号：${code}\n账号：${username}\n密码：${password}\n\n仅供体验，不用于真实营业。所有房间、会员和金额均为测试数据。\n`);
 const rooms=[];for(let i=1;i<=8;i++)rooms.push(await api('/rooms',{room_no:'A'+String(i).padStart(2,'0'),room_name:['听澜','云栖','观澜','竹影','静川','松风','揽月','知序'][i-1],room_type:i>6?'雅致包厢':'足浴雅间',capacity:i>6?4:2,sort_order:i},store.id));
 for(let i=1;i<=3;i++)await api('/rooms',{room_no:'B0'+i,room_name:['映山','青禾','晚晴'][i-1],capacity:2},second.id);
 const services=[];for(const [name,price,duration] of [['澜序足道',198,60],['深度舒缓',298,90],['尊享养护',398,120]] as const)services.push(await api('/items',{name,type:'service',price,duration},store.id));
 const tea=await api('/items',{name:'桂花乌龙',type:'product',price:28,stock:80,cost:6,unit:'壶'},store.id);
 for(let i=1;i<=6;i++){const technician=await api('/technicians',{name:String(i).padStart(2,'0')+'号技师',code:'T0'+i,level:i<3?'高级':'普通',commission_rate:25},store.id);await api('/technicians/'+technician.id+'/clock',{status:'on'},store.id)}
 for(let i=1;i<=12;i++)await api('/wristbands',{code:String(100+i)},store.id);
 for(const [name,balance] of [['体验会员 · 青禾',500],['体验会员 · 云栖',1000],['体验会员 · 松风',2000]] as const)await api('/members',{name,balance,card_type:'storage',discount:1,reason:'隔离测试预览期初权益，不是真实资金'},store.id);
 for(let i=0;i<2;i++){let order=await api('/sessions',{resource_id:rooms[i].id,guest_name:'体验客人 '+(i+1)},store.id);order=await api('/sessions/'+order.id+'/items',{catalog_id:services[i].id,quantity:1,version:order.version},store.id);await api('/sessions/'+order.id+'/items',{catalog_id:tea.id,quantity:1,version:order.version},store.id)}
 await api('/rooms/'+rooms[6].id+'/status',{status:'cleaning'},store.id);
 console.log(JSON.stringify({preview_seeded:true,merchant_code:code,stores:2,rooms:11,technicians:6,credentials_file:'.runtime/测试版登录信息.txt'}));
}finally{await h.stop()}
