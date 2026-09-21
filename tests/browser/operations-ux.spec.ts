import {test,expect} from './fixtures.js';
import {harness,succeeded,password} from '../helpers.js';

test('营业待办、排钟原因、设备向导、流水追溯和实点现金按真实接口工作',async({page})=>{
 test.setTimeout(150000);
 const h=await harness({closePoolsOnStop:false}),crashes:string[]=[];page.on('pageerror',e=>crashes.push(e.message));
 try{
  const a=await h.onboard(),store=a.stores[0].id;
  const post=async(path:string,body:any)=>succeeded(await h.api(a.token,store,path,'POST',body));
  await post('/shifts/start',{start_cash:100});
  const room=await post('/rooms',{room_no:'UX101'});await post('/rooms',{room_no:'UX102'});
  const tech=await post('/technicians',{name:'验收技师',code:'UX1'});await post('/technicians/'+tech.id+'/clock',{status:'on'});
  const item=await post('/items',{name:'验收服务',type:'service',price:100,duration:60});
  await post('/clocks/settings',{confirmation_mode:true});
  const order=await post('/sessions',{resource_id:room.id,deposit:10});await post('/sessions/'+order.id+'/items',{version:order.version,catalog_id:item.id,technician_id:tech.id});
  await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  const roomCard=page.getByRole('button',{name:/^房间 UX101/});await expect(roomCard).toContainText('待接单');await expect(roomCard).toContainText('验收服务');
  await page.getByRole('button',{name:'待处理(1)',exact:true}).click();await expect(page.getByRole('button',{name:/^房间 UX102/})).toHaveCount(0);
  await page.getByRole('button',{name:'待处理(1)',exact:true}).click();await expect(page.getByRole('button',{name:/^房间 UX102/})).toBeVisible();
  const nav=page.getByRole('navigation',{name:'主导航'});
  await nav.getByRole('button',{name:/钟房排钟/}).click();await page.getByRole('button',{name:'同钟数排钟顺序',exact:true}).click();
  const queue=page.getByRole('dialog',{name:'同钟数排钟顺序'});await queue.getByRole('button',{name:'保存排钟顺序'}).click();await expect(queue.getByRole('alert')).toContainText('调整原因');
  await queue.getByLabel('排钟调整原因',{exact:true}).fill('班次现场核对');await queue.getByRole('button',{name:'保存排钟顺序'}).click();await expect(queue).toBeHidden();
  await page.getByRole('button',{name:'排钟调整记录',exact:true}).click();const history=page.getByRole('dialog',{name:'排钟调整记录'});await expect(history).toContainText('班次现场核对');await history.getByRole('button',{name:'关闭排钟调整记录',exact:true}).click();
  await nav.getByRole('button',{name:'门店设置',exact:true}).click();await page.getByRole('button',{name:'设备接口',exact:true}).click();
  const steps=page.getByRole('navigation',{name:'设备配置步骤'});await expect(steps.getByRole('button')).toHaveCount(4);await steps.getByRole('button',{name:'3. 刷牌输入测试'}).click();await expect(page.getByLabel('刷牌器检测输入')).toBeInViewport();
  await nav.getByRole('button',{name:'报表中心',exact:true}).click();await page.getByRole('button',{name:'查看原始记账流水'}).click();const entries=page.getByRole('dialog',{name:'报表原始流水'});await expect(entries).toContainText('押金收取');await expect(entries).toContainText(order.order.order_no);await entries.getByRole('button',{name:'关闭报表原始流水',exact:true}).click();
  await nav.getByRole('button',{name:'交接班',exact:true}).click();await page.getByRole('button',{name:/结束交班/}).click();const close=page.getByRole('dialog',{name:'结束交接班'});await close.getByLabel('实点现金（元）').fill('109');await close.getByRole('textbox').last().fill('现金差异已核对');
  // Commit through the real API, then lose the first reply. Retrying must use the original request.
  let dropped=false;const keys:string[]=[];
  await page.route('**/api/merchant/v1/shifts/end',async route=>{keys.push(route.request().headers()['idempotency-key']);if(!dropped){dropped=true;const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed')}else await route.continue()});
  await close.getByRole('button',{name:'确认交接'}).click();await expect(close.getByRole('button',{name:'核对原交接结果'})).toBeVisible();await expect(close.getByLabel('实点现金（元）')).toBeDisabled();await close.getByRole('button',{name:'核对原交接结果'}).click();await expect(close).toBeHidden();expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
  const shifts=succeeded(await h.api(a.token,store,'/shifts'));expect(shifts[0].cash_difference).toBe(-1);expect(shifts[0].actual_cash).toBe(109);expect(crashes).toEqual([]);
 }finally{await h.stop()}
});
