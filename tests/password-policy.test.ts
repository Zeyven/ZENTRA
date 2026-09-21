import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Password,MerchantLogin} from '@za-spa/contracts';
import {harness} from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>;
after(async()=>{if(h)await h.stop()});
test('password boundaries are 8 and 20; existing login secrets remain accepted',()=>{
 for(const value of ['12345678','x'.repeat(20),'abcdefgh','八个字符密码测试'])assert.equal(Password.safeParse(value).success,true);
 for(const value of ['x'.repeat(7),'x'.repeat(21)])assert.equal(Password.safeParse(value).success,false);
 assert.equal(MerchantLogin.safeParse({merchant_code:'TEST',username:'zeyven',password:'zeyven'}).success,true);
});
test('merchant password creation and change enforce both limits without invalidating failed changes',async()=>{
 h=await harness();const a=await h.onboard();
 const api=(path:string,body:any,method='POST')=>h.api(a.token,undefined,path,method,body);
 for(const n of [7,21])assert.equal((await api('/users',{username:'reject'+n,name:'无效密码',password:'x'.repeat(n)})).status,400);
 for(const n of [8,20])assert.equal((await api('/users',{username:'accept'+n,name:'有效密码',password:'x'.repeat(n)})).status,200);
 const {password}=await import('./helpers.js');
 for(const n of [7,21])assert.equal((await api('/auth/password',{current_password:password,new_password:'x'.repeat(n)})).status,400);
 assert.equal((await api('/auth/password',{current_password:password,new_password:'12345678'})).status,200);
 const login=await h.call('/api/merchant/v1/auth/login','POST',{merchant_code:a.merchant.code,username:'13800138000',password:'12345678'});assert.equal(login.status,200);
 assert.equal((await h.api(login.data.token,undefined,'/auth/password','POST',{current_password:'12345678',new_password:'x'.repeat(20)})).status,200);
 assert.equal((await h.call('/api/merchant/v1/auth/login','POST',{merchant_code:a.merchant.code,username:'13800138000',password:'x'.repeat(20)})).status,200);
});

