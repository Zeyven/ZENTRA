import {test,expect} from './fixtures.js';import {harness,password,succeeded} from '../helpers.js';
test('员工日常操作可逐项关闭，按钮及真实接口一致；角色不支持的敏感项不可勾选',async({page,browser})=>{
 const h=await harness({closePoolsOnStop:false});try{
 const a=await h.onboard(),s=a.stores[0].id;const command=async(p:string,b:any)=>succeeded(await h.api(a.token,s,p,'POST',b));
 const u=await command('/users',{username:'daily',password,name:'日常收银'});succeeded(await h.api(a.token,undefined,'/users/'+u.id+'/grants','PUT',{grants:[{store_id:s,role:'floor',pages:['board'],actions:[]}]}));
 const room=await command('/rooms',{room_no:'D01'}),item=await command('/items',{name:'操作权限服务',type:'service',price:100,duration:60});const tech=await command('/technicians',{name:'技师',code:'D01'});await command('/technicians/'+tech.id+'/clock',{status:'on'});let order=await command('/sessions',{resource_id:room.id});order=await command('/sessions/'+order.id+'/items',{catalog_id:item.id,technician_id:tech.id,version:order.version});
 const login=async(p:any,username:string)=>{await p.goto('http://127.0.0.1:5175/');await p.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await p.getByLabel('账号',{exact:true}).fill(username);await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录',exact:true}).click()};
 await login(page,'13800138000');await page.getByRole('button',{name:'商家管理',exact:true}).click();await page.getByRole('row').filter({hasText:'日常收银'}).getByRole('button',{name:'编辑授权'}).click();const dialog=page.getByRole('dialog',{name:'日常收银的门店授权'});const prefix=a.stores[0].name+'：';
 await expect(dialog.getByLabel(prefix+'按项目价格加钟',{exact:true})).toBeChecked();await dialog.getByLabel(prefix+'按项目价格加钟',{exact:true}).uncheck();await expect(dialog.getByLabel(prefix+'审批操作',{exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'保存授权'}).click();await expect(dialog).toBeHidden();
 const ctx=await browser.newContext();try{const staff=await ctx.newPage();await login(staff,'daily');await staff.getByRole('button',{name:/^房间 D01/}).click();await expect(staff.getByRole('button',{name:'加钟',exact:true}).first()).toBeDisabled();await expect(staff.getByRole('button',{name:'落钟',exact:true}).first()).toBeEnabled();const token=succeeded(await h.api('',undefined,'/auth/login','POST',{merchant_code:a.merchant.code,username:'daily',password})).token;const r=await h.api(token,s,'/session-items/'+order.items[0].id+'/add-time','POST',{version:order.version,minutes:30});expect(r.code).toBe('OPERATION_FORBIDDEN');}finally{await ctx.close()}
 }finally{await h.stop()}
});
test('只读店长可以查询会员设置报表，但不能编辑或导出',async({page})=>{
 const h=await harness({closePoolsOnStop:false});try{
  const a=await h.onboard(),store=a.stores[0].id;
  const user=succeeded(await h.api(a.token,undefined,'/users','POST',{username:'readonly-manager',password,name:'只读店长'}));
  succeeded(await h.api(a.token,undefined,'/users/'+user.id+'/grants','PUT',{grants:[{store_id:store,role:'manager',pages:['members','settings','reports'],actions:[],operations:[]}]}));
  await page.goto('/');await page.getByLabel('商家编号',{exact:true}).fill(a.merchant.code);await page.getByLabel('账号',{exact:true}).fill('readonly-manager');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'会员管理',exact:true}).click();await expect(page.getByRole('button',{name:'+ 开卡',exact:true})).toBeDisabled();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'门店设置',exact:true}).click();await expect(page.getByRole('button',{name:'保存门店信息',exact:true})).toBeDisabled();await expect(page.getByText('当前账号可查看此页，未授权修改操作。')).toBeVisible();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'报表中心',exact:true}).click();await expect(page.getByRole('button',{name:/导出 CSV/})).toBeDisabled();await expect(page.getByRole('alert')).toHaveCount(0);
 }finally{await h.stop()}
});
