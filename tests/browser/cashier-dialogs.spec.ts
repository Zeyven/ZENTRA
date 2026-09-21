import {test,expect} from './fixtures.js';
import {harness,password,succeeded} from '../helpers.js';
test('真实收银落钟、赠单和退单的原因弹窗可输入，提交一次并持久化',async({page})=>{
 test.setTimeout(120000);const h=await harness({closePoolsOnStop:false});
 try{
  const a=await h.onboard(),store=a.stores[0].id;
  const api=async(p:string,body?:any,method='POST')=>succeeded(await h.api(a.token,store,p,method,body));
  const room=await api('/rooms',{room_no:'701'}),item=await api('/items',{name:'弹窗验收足浴',type:'service',price:100,duration:60});
  const tech=await api('/technicians',{name:'弹窗验收技师',code:'01'});await api('/technicians/'+tech.id+'/clock',{status:'on'});
  let order=await api('/sessions',{resource_id:room.id});order=await api('/sessions/'+order.id+'/items',{catalog_id:item.id,technician_id:tech.id,version:order.version});
  const product=await api('/items',{name:'退单验收茶水',type:'product',price:10,stock:10});order=await api('/sessions/'+order.id+'/items',{catalog_id:product.id,version:order.version});
  const cashier=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'cashier',name:'收银验收',password}));
  succeeded(await h.api(a.token,undefined,'/users/'+cashier.id+'/grants','PUT',{grants:[{store_id:store,role:'floor',pages:['board'],actions:[]}]}));
  const token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'cashier',password})).token;
  const serviceId=order.items.find((i:any)=>i.item_id===item.id).id;
  for(const action of ['gift','refund','price'])expect((await h.api(token,store,`/session-items/${serviceId}/${action}`,'POST',{version:order.version,reason:'未授权',...(action==='price'?{price:1}:{})})).status).toBe(403);
  expect((await h.api(token,a.stores[1].id,`/session-items/${serviceId}/add-time`,'POST',{version:order.version,minutes:30})).status).toBe(403);
  succeeded(await h.api(a.token,undefined,'/users/'+cashier.id+'/grants','PUT',{grants:[{store_id:store,role:'floor',pages:['board'],actions:['gift','refund']}]}));
  await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('cashier');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:/^房间 701/}).click();
  await page.getByRole('button',{name:'加钟',exact:true}).first().click();const extended=page.waitForResponse(r=>r.url().includes('/session-items/')&&r.url().endsWith('/add-time'));await page.getByRole('alertdialog',{name:'加钟',exact:true}).getByRole('button',{name:'确定',exact:true}).click();expect((await(await extended).json()).ok).toBe(true);await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/session-items/'))writes.push(r.url())});
  for(const [button,title] of [['落钟','结束服务原因'],['赠单','赠送原因'],['退单','退单原因']]){
   await page.getByRole('button',{name:button,exact:true}).first().click();await page.getByRole('alertdialog',{name:button,exact:true}).getByRole('button',{name:'确定',exact:true}).click();
   const reason=page.getByRole('dialog',{name:title,exact:true});await reason.getByRole('textbox').click();await reason.getByRole('textbox').fill('门店弹窗回归：'+button);
   const saved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/session-items/'));
   await reason.getByRole('button',{name:'确认并继续'}).click();expect((await(await saved).json()).ok).toBe(true);await expect(reason).toHaveCount(0);await expect(page.getByRole('alertdialog',{name:button,exact:true})).toHaveCount(0);
  }
  const after=await api('/orders/'+order.id,undefined,'GET');expect(after.items.find((i:any)=>i.item_id===item.id)).toMatchObject({status:'done',is_gift:1,duration:90});expect(after.items.find((i:any)=>i.item_id===product.id)).toMatchObject({status:'refunded',is_refund:1});expect(writes).toHaveLength(3);
 }finally{await h.stop()}
});
