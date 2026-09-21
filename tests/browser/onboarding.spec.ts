import {test,expect} from './fixtures.js';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {platformPool,inTenant,tenantQuery} from '../../apps/server/src/db/pools.js';
import {hashPassword} from '../../apps/server/src/security.js';
const password='UI-Test-Pwd-718!',username='ui-'+randomUUID(),code='UI-'+randomUUID().slice(0,8).toUpperCase();
test.beforeAll(async()=>{assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/za_spa_saas_test');await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3)',[username,await hashPassword(password),'界面验收管理员'])});
test('真实报表和工资锁定，价格与复合提成规则的保存、失败反馈和多端版本校验',async({page,request})=>{
 const crashes:string[]=[];page.on('pageerror',e=>crashes.push(e.message));
 const login=await(await request.post('/api/platform/v1/auth/login',{data:{username,password}})).json(),merchantCode='REPORT-'+randomUUID().slice(0,8).toUpperCase();
 const created=await(await request.post('/api/platform/v1/merchants',{headers:{Authorization:'Bearer '+login.data.token},data:{code:merchantCode,name:'报表验收'}})).json();expect(created.ok).toBe(true);
 expect((await(await request.post('/api/merchant/v1/auth/activate',{data:{token:created.data.invite.token,username:'13800138000',password,name:'报表老板'}})).json()).ok).toBe(true);
 const signed=await(await request.post('/api/merchant/v1/auth/login',{data:{merchant_code:merchantCode,username:'13800138000',password}})).json(),headers={Authorization:'Bearer '+signed.data.token};let storeId:number|undefined;
 async function command(path:string,data?:any,method='POST'){const result=await(await request.fetch('/api/merchant/v1'+path,{method,headers:{...headers,'Idempotency-Key':randomUUID(),...(storeId?{'X-Store-ID':String(storeId)}:{})},data})).json();expect(result.ok,JSON.stringify(result)).toBe(true);return result.data}
 const store=await command('/stores',{code:'001',name:'报表店'});storeId=store.id;
 const room=await command('/rooms',{room_no:'401'}),item=await command('/items',{name:'报表茶水',type:'product',price:10,cost:2});let order=await command('/sessions',{resource_id:room.id});order=await command('/sessions/'+order.id+'/items',{catalog_id:item.id,quantity:1,version:order.version});await command('/sessions/'+order.id+'/checkout',{version:order.version,payments:[{method:'现金',amount:10}]});
 await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(merchantCode);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/报表/}).click();await expect(page.getByRole('heading',{name:'报表中心'})).toBeVisible();await expect(page.getByRole('row').filter({hasText:'报表茶水'})).toContainText('10.00');
 for(const label of ['技师业绩','会员报表','客流统计','团购核销','房态报表','收银汇总','经营分析','增长简报']){await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('status').filter({hasText:'正在加载所选报表'})).toBeHidden();await expect(page.getByRole('alert')).toHaveCount(0)}
 await page.getByRole('button',{name:'员工工资',exact:true}).click();await expect(page.getByRole('button',{name:'锁定本月工资',exact:true})).toBeEnabled();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'锁定本月工资',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click()});await expect(page.getByText('该月工资已锁定',{exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/门店设置/}).click();await page.getByRole('button',{name:'动态定价',exact:true}).click();
 await page.getByPlaceholder('如：周末晚间加价').fill('价格验收');let saved=page.waitForResponse(r=>r.url().endsWith('/pricing-rules')&&r.request().method()==='POST');await page.getByRole('button',{name:'+ 新增规则',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click()});expect((await(await saved).json()).ok).toBe(true);const row=page.getByRole('row').filter({hasText:'价格验收'});await expect(row).toBeVisible();
 await row.getByRole('button',{name:'编辑',exact:true}).click();const rules=await command('/pricing-rules',undefined,'GET'),rule=rules[0];await command('/pricing-rules',{id:rule.id,version:rule.version,name:rule.name,adjustment_type:'fixed',adjustment_value:2});
 saved=page.waitForResponse(r=>r.url().endsWith('/pricing-rules')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存修改',exact:true}).click();expect((await(await saved).json()).code).toBe('VERSION_CONFLICT');await expect(page.getByRole('alert').filter({hasText:'规则已被其他终端修改'})).toBeVisible();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'阶梯提成',exact:true}).click();await page.getByLabel('提成规则名称',{exact:true}).fill('钟务验收规则');const commissionSaved=page.waitForResponse(r=>r.url().endsWith('/commission-rules')&&r.request().method()==='POST');await page.getByRole('button',{name:'新增提成规则',exact:true}).click();expect((await(await commissionSaved).json()).ok).toBe(true);await expect(page.getByRole('row').filter({hasText:'钟务验收规则'})).toBeVisible();
 const evidence=await inTenant(created.data.merchant.id,async()=>({snapshots:(await tenantQuery('SELECT gross_amount,discount_amount FROM settlement_lines WHERE store_id=$1',[store.id])).rows,periods:(await tenantQuery('SELECT month FROM payroll_periods WHERE store_id=$1',[store.id])).rows.length,rules:(await tenantQuery('SELECT count(*) AS count FROM pricing_rules WHERE store_id=$1',[store.id])).rows[0].count}));expect(evidence.snapshots).toEqual([{gross_amount:10,discount_amount:0}]);expect(evidence.periods).toBe(1);expect(evidence.rules).toBe(1);expect(crashes).toEqual([]);
});
test('平台开通 → 老板激活 → 创建门店 → 房间商品 → 开房结账，确认真实落库',async({page,context})=>{
 const crashes:string[]=[];page.on('pageerror',error=>crashes.push(error.message));
 await page.goto('/platform');await page.getByLabel('平台账号').fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录平台',exact:true}).click();
 await page.getByLabel('商家编号',{exact:true}).fill(code);await page.getByLabel('商家名称').fill('界面验收商家');await page.getByRole('button',{name:'开通并生成老板邀请'}).click();
 const invite=page.getByLabel('老板邀请链接');await expect(invite).toHaveValue(/\/activate\?token=/);await page.goto(await invite.inputValue());
 await page.getByLabel('姓名',{exact:true}).fill('验收老板');await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByLabel('确认密码').fill(password);await page.getByRole('button',{name:'激活账号',exact:true}).click();
 await page.getByLabel('商家编号',{exact:true}).fill(code);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 await expect(page.getByRole('heading',{name:'商家管理',exact:true})).toBeVisible();await page.getByLabel('门店编号',{exact:true}).fill('001');await page.getByLabel('门店名称',{exact:true}).fill('验收一店');await page.getByRole('button',{name:'新增门店',exact:true}).click();
 await expect(page.getByLabel('当前门店')).toContainText('验收一店');await page.getByRole('button',{name:'门店设置',exact:false}).click();await page.getByRole('button',{name:'房间管理',exact:true}).click();await page.getByRole('button',{name:'+ 新增房间',exact:true}).click();
 const roomDialog=page.getByRole('dialog',{name:'新增房间'});await roomDialog.locator('input').nth(0).fill('101');await roomDialog.locator('input').nth(1).fill('验收房间');await roomDialog.getByRole('button',{name:'保存',exact:true}).click();await expect(roomDialog).toBeHidden();await expect(page.getByRole('cell',{name:'验收房间',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'项目商品',exact:false}).click();await page.getByRole('button',{name:'商品酒水',exact:true}).click();await page.getByRole('button',{name:/新增商品/}).click();
 const itemDialog=page.getByRole('dialog');await itemDialog.locator('input').nth(0).fill('验收茶水');await itemDialog.locator('input[type="number"]').nth(0).fill('10');await itemDialog.getByRole('button',{name:'保存',exact:true}).click();await expect(itemDialog).toBeHidden();
 // New products start with zero stock. Receive real stock before selling; do not bypass inventory checks.
 await page.getByRole('button',{name:'库存盘点',exact:true}).click();await page.getByRole('row').filter({hasText:'验收茶水'}).getByRole('button',{name:'入库',exact:true}).click();
 const stockDialog=page.getByRole('dialog',{name:'库存管理：验收茶水',exact:true});await stockDialog.getByLabel('库存操作数量').fill('2');await stockDialog.getByLabel('库存操作原因').fill('开业验收入库');await stockDialog.getByRole('button',{name:'确认',exact:true}).click();await expect(stockDialog).toBeHidden();
 const second=await context.newPage();await second.goto('/');await second.getByLabel('商家编号',{exact:true}).fill(code);await second.getByLabel('账号',{exact:true}).fill('13800138000');await second.getByLabel('密码',{exact:true}).fill(password);await second.getByRole('button',{name:'登录',exact:true}).click();await expect(second.getByRole('button',{name:'房间 101，空闲',exact:true})).toBeVisible();
 const detailReads:string[]=[];let checkoutWrites=0;page.on('request',request=>{if(request.method()==='GET'&&/\/orders\/\d+$/.test(request.url()))detailReads.push(request.url());if(request.method()==='POST'&&request.url().endsWith('/checkout'))checkoutWrites++});
 await page.getByRole('button',{name:'房态看板',exact:false}).click();await page.getByRole('button',{name:'房间 101，空闲',exact:true}).click();const open=page.getByRole('dialog',{name:'开房',exact:true});await open.getByRole('button',{name:'确认开房'}).click();await expect(open).toBeHidden();
 await expect(second.getByRole('button',{name:'房间 101，使用中',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'返回房态或账单'})).toBeVisible();await page.getByRole('button',{name:'商品酒水',exact:true}).click();await page.getByRole('button',{name:'添加商品 验收茶水',exact:true}).click();
 const add=page.getByRole('dialog');await add.getByRole('button',{name:'添加',exact:true}).click();await expect(add).toBeHidden();
 await page.getByRole('button',{name:/结\s*账（待收/}).evaluate((button:HTMLButtonElement)=>{button.click();button.click()});
 await expect(page.getByRole('alert').filter({hasText:'收款金额应为'}).first()).toBeVisible();
 await page.getByRole('button',{name:'全部使用现金收款',exact:true}).click();
 const checkoutResponse=page.waitForResponse(r=>r.url().endsWith('/checkout')&&r.request().method()==='POST');
 await page.getByRole('button',{name:/结\s*账（待收/}).evaluate((button:HTMLButtonElement)=>{button.click();button.click()});
 const saved=await (await checkoutResponse).json();expect(saved.ok,JSON.stringify(saved)).toBe(true);expect(saved.data.order.status).toBe('closed');
 // UI assertions and database assertions describe the same committed order, not mock success.
 const tenant=(await platformPool.query('SELECT id FROM merchants WHERE code=$1',[code])).rows[0];
 await expect.poll(()=>inTenant(tenant.id,async()=>Number((await tenantQuery("SELECT count(*) FROM orders WHERE status='closed' AND payable=10 AND paid=10")).rows[0].count))).toBe(1);
 const ledger=await inTenant(tenant.id,async()=>(await tenantQuery("SELECT amount FROM payments WHERE reversed_at IS NULL")).rows);expect(ledger).toEqual([{amount:10}]);expect(crashes).toEqual([]);
 const inventory=await inTenant(tenant.id,async()=>({stock:(await tenantQuery("SELECT stock FROM items WHERE name='验收茶水'")).rows[0].stock,received:(await tenantQuery("SELECT qty FROM inventory_movements WHERE source_type='manual' AND remark='开业验收入库'")).rows}));expect(inventory).toEqual({stock:1,received:[{qty:2}]});
 await expect(page.getByTestId('settlement-details')).toContainText('验收一店');await expect(page.getByRole('button',{name:'打印小票',exact:true})).toBeVisible();
 await page.emulateMedia({media:'print'});await expect(page.locator('#saas-receipt-print')).toBeVisible();await expect(page.getByRole('navigation',{name:'主导航'})).toBeHidden();expect(await page.locator('#saas-receipt-print').innerText()).toContain('验收茶水');const pdf=await page.pdf({width:'80mm',height:'200mm',printBackground:true});expect(pdf.subarray(0,4).toString()).toBe('%PDF');expect(pdf.length).toBeGreaterThan(1000);await page.emulateMedia({media:'screen'});
 await expect(second.getByRole('button',{name:'房间 101，待打扫',exact:true})).toBeVisible();expect(checkoutWrites).toBe(1);expect(detailReads).toEqual([]);await second.close();
});
test('结账已提交但响应丢失时，使用原请求重试且只记一笔收款',async({page,request})=>{
 const login=await (await request.post('/api/platform/v1/auth/login',{data:{username,password}})).json();
 const merchantCode='LOSS-'+randomUUID().slice(0,8).toUpperCase();
 const created=await (await request.post('/api/platform/v1/merchants',{headers:{Authorization:'Bearer '+login.data.token},data:{code:merchantCode,name:'弱网验收'}})).json();
 expect(created.ok).toBe(true);const activated=await (await request.post('/api/merchant/v1/auth/activate',{data:{token:created.data.invite.token,username:'13800138000',password,name:'弱网老板'}})).json();expect(activated.ok).toBe(true);
 const signed=await (await request.post('/api/merchant/v1/auth/login',{data:{merchant_code:merchantCode,username:'13800138000',password}})).json();
 const headers={Authorization:'Bearer '+signed.data.token};const store=await (await request.post('/api/merchant/v1/stores',{headers,data:{code:'001',name:'弱网店'}})).json();
 async function post(path:string,data:any){const result=await (await request.post('/api/merchant/v1'+path,{headers:{...headers,'X-Store-ID':String(store.data.id),'Idempotency-Key':randomUUID()},data})).json();expect(result.ok,JSON.stringify(result)).toBe(true);return result.data}
 const room=await post('/rooms',{room_no:'201'}),item=await post('/items',{type:'product',name:'弱网茶水',price:12});let order=await post('/sessions',{resource_id:room.id});order=await post('/sessions/'+order.id+'/items',{version:order.version,catalog_id:item.id,quantity:1});
 await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(merchantCode);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'房间 201，使用中',exact:true}).click();await page.getByRole('button',{name:'全部使用现金收款',exact:true}).click();
 let releaseReads!:()=>void;const released=new Promise<void>(resolve=>{releaseReads=resolve});let losing=false;const keys:string[]=[];
 await page.route('**/api/merchant/v1/orders/'+order.id,async route=>{if(losing)await released;await route.continue()});
 await page.route('**/sessions/'+order.id+'/checkout',async route=>{
  keys.push(route.request().headers()['idempotency-key']);if(keys.length===1){losing=true;const actual=await route.fetch();expect(actual.ok()).toBe(true);await route.abort('failed')}else await route.continue();
 });
 try{
  await page.getByRole('button',{name:/结\s*账（待收/}).click();await expect(page.getByRole('alert').filter({hasText:/Failed to fetch|NetworkError|网络|结果/}).first()).toBeVisible();
  const retry=page.waitForResponse(r=>r.url().endsWith('/checkout'));await page.getByRole('button',{name:/结\s*账（待收/}).click();const response=await (await retry).json();expect(response.ok,JSON.stringify(response)).toBe(true);expect(response.data.order.status).toBe('closed');expect(keys.length).toBe(2);expect(keys[0]).toBe(keys[1]);
  const payments=await inTenant(created.data.merchant.id,async()=>(await tenantQuery('SELECT amount FROM payments WHERE order_id=$1',[order.id])).rows);expect(payments).toEqual([{amount:12}]);
 }finally{releaseReads()}
});

test('前台预约到店开房及顾客扫码取号，与前台真实叫号联动',async({page,request,context})=>{
 const login=await (await request.post('/api/platform/v1/auth/login',{data:{username,password}})).json(),merchantCode='BOOK-'+randomUUID().slice(0,8).toUpperCase();
 const created=await (await request.post('/api/platform/v1/merchants',{headers:{Authorization:'Bearer '+login.data.token},data:{code:merchantCode,name:'预约排队验收'}})).json();expect(created.ok).toBe(true);
 expect((await (await request.post('/api/merchant/v1/auth/activate',{data:{token:created.data.invite.token,username:'13800138000',password,name:'预约老板'}})).json()).ok).toBe(true);
 const signed=await (await request.post('/api/merchant/v1/auth/login',{data:{merchant_code:merchantCode,username:'13800138000',password}})).json(),headers={Authorization:'Bearer '+signed.data.token};
 const store=await (await request.post('/api/merchant/v1/stores',{headers,data:{code:'001',name:'预约验收店'}})).json();expect(store.ok).toBe(true);
 const room=await (await request.post('/api/merchant/v1/rooms',{headers:{...headers,'X-Store-ID':String(store.data.id),'Idempotency-Key':randomUUID()},data:{room_no:'301',room_name:'预约三零一'}})).json();expect(room.ok).toBe(true);
 await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(merchantCode);await page.getByLabel('账号',{exact:true}).fill('13800138000');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'预约登记',exact:false}).click();await page.getByRole('button',{name:'+ 新增预约',exact:true}).click();const form=page.getByRole('dialog',{name:'新增预约'});await form.getByLabel('预约客户姓名').fill('浏览器预约客人');await form.getByLabel('预约时间',{exact:true}).fill('2026-12-20T14:00');await form.getByLabel('预约房间').selectOption(String(room.data.id));await form.getByRole('button',{name:'保存',exact:true}).click();await expect(form).toBeHidden();
 const row=page.getByRole('row').filter({hasText:'浏览器预约客人'});await expect(row).toContainText('12-20 14:00');await row.getByRole('button',{name:'到店',exact:true}).click();await page.getByRole('button',{name:'已到店',exact:true}).click();await page.getByRole('row').filter({hasText:'浏览器预约客人'}).getByRole('button',{name:'开房',exact:true}).click();await expect(page.getByRole('row').filter({hasText:'浏览器预约客人'})).toContainText('订单 #');
 await page.getByRole('button',{name:'排队叫号',exact:false}).click();await expect(page.getByAltText('扫码排队')).toBeVisible();
 const customer=await context.newPage();await customer.goto(`/customer/${merchantCode}/001/queue`);await expect(customer.getByRole('heading',{name:'预约验收店'})).toBeVisible();await customer.getByLabel('顾客姓名',{exact:true}).fill('扫码顾客');await customer.getByLabel('人数',{exact:true}).fill('3');await customer.getByRole('button',{name:'确认取号',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click()});await expect(customer.getByRole('status')).toHaveText('等待叫号');await expect(customer.getByText('A001',{exact:true})).toBeVisible();
 const queueRow=page.getByRole('row').filter({hasText:'扫码顾客'});await expect(queueRow).toBeVisible();await queueRow.getByRole('button',{name:'叫号',exact:true}).click();await customer.getByRole('button',{name:'刷新状态',exact:true}).click();await expect(customer.getByRole('status')).toHaveText('已叫号，请到前台');
 const rows=await inTenant(created.data.merchant.id,async()=>(await tenantQuery('SELECT queue_no,people,status FROM queue WHERE store_id=$1',[store.data.id])).rows);expect(rows).toEqual([{queue_no:'A001',people:3,status:'called'}]);await customer.close();
});

test('库存报损提交审批，另一账号审核后原申请人执行并只扣一次库存',async({page,request,context})=>{
 const login=await (await request.post('/api/platform/v1/auth/login',{data:{username,password}})).json(),merchantCode='AUDIT-'+randomUUID().slice(0,8).toUpperCase();
 const created=await (await request.post('/api/platform/v1/merchants',{headers:{Authorization:'Bearer '+login.data.token},data:{code:merchantCode,name:'审批验收'}})).json();expect(created.ok).toBe(true);
 expect((await (await request.post('/api/merchant/v1/auth/activate',{data:{token:created.data.invite.token,username:'13800138000',password,name:'审批老板'}})).json()).ok).toBe(true);
 const signed=await (await request.post('/api/merchant/v1/auth/login',{data:{merchant_code:merchantCode,username:'13800138000',password}})).json(),headers={Authorization:'Bearer '+signed.data.token};
 async function command(path:string,data:any,method='POST',storeId?:number){const result=await(await request.fetch('/api/merchant/v1'+path,{method,headers:{...headers,'Idempotency-Key':randomUUID(),...(storeId?{'X-Store-ID':String(storeId)}:{})},data})).json();expect(result.ok,JSON.stringify(result)).toBe(true);return result.data}
 const store=await command('/stores',{code:'001',name:'审批店'}),manager=await command('/users',{username:'manager',password,name:'审核店长'});await command('/users/'+manager.id+'/grants',{grants:[{store_id:store.id,role:'manager'}]},'PUT');
 const item=await command('/items',{name:'审批茶杯',type:'product',price:20,cost:10,stock:5},'POST',store.id);await command('/settings',{approval_thresholds:JSON.stringify({inventory_adjustment:10,refund:0,discount:0})},'POST',store.id);
 async function signIn(target:typeof page,account:string){await target.goto('/');await target.getByLabel('商家编号',{exact:true}).fill(merchantCode);await target.getByLabel('账号',{exact:true}).fill(account);await target.getByLabel('密码',{exact:true}).fill(password);await target.getByRole('button',{name:'登录',exact:true}).click()}
 await signIn(page,'13800138000');await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'项目商品',exact:false}).click();await page.getByRole('button',{name:'库存盘点',exact:true}).click();await page.getByRole('row').filter({hasText:'审批茶杯'}).getByRole('button',{name:'报损',exact:true}).click();
 const stock=page.getByRole('dialog',{name:'库存管理：审批茶杯'});await stock.getByLabel('库存操作数量').fill('2');await stock.getByLabel('库存操作原因').fill('验收破损杯子');await stock.getByRole('button',{name:'确认',exact:true}).click();await expect(stock.getByRole('status')).toContainText('库存尚未改变');
 const reviewer=await context.newPage();await signIn(reviewer,'manager');await reviewer.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'审批中心',exact:false}).click();const approval=reviewer.getByRole('article').filter({hasText:'验收破损杯子'});await approval.getByRole('button',{name:'批准',exact:true}).click();await expect(approval).toContainText('已批准，待执行');
 const saved=page.waitForResponse(r=>r.url().endsWith('/inventory/move')&&r.request().method()==='POST');await stock.getByRole('button',{name:'审批后执行',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();button.click()});const result=await(await saved).json();expect(result.ok,JSON.stringify(result)).toBe(true);await expect(stock).toBeHidden();
 const evidence=await inTenant(created.data.merchant.id,async()=>({item:(await tenantQuery('SELECT stock FROM items WHERE id=$1',[item.id])).rows[0],movements:(await tenantQuery("SELECT qty FROM inventory_movements WHERE item_id=$1 AND source_type='loss'",[item.id])).rows,approval:(await tenantQuery('SELECT status FROM approval_requests WHERE store_id=$1',[store.id])).rows}));expect(evidence).toEqual({item:{stock:3},movements:[{qty:2}],approval:[{status:'consumed'}]});await reviewer.close();
});
