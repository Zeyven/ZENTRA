import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {harness,succeeded,password} from './helpers.js';
let h:Awaited<ReturnType<typeof harness>>;
before(async()=>{h=await harness()});after(()=>h.stop());
const platform=(path:string,method='GET',body?:unknown)=>h.call('/api/platform/v1'+path,method,body,h.platformToken);
const create=()=>platform('/merchants','POST',{code:'INV-'+randomUUID().slice(0,8).toUpperCase(),name:'邀请验收',member_mode:'store'}).then(succeeded);
const activate=(token:string)=>h.call('/api/merchant/v1/auth/activate','POST',{token,username:'owner',password,name:'老板'});
test('reissue invalidates the previous link, revoke prevents activation, activated owner cannot be replaced',async()=>{
 const m=await create(),path='/merchants/'+m.merchant.id+'/invite',meta=succeeded(await platform(path));assert(!JSON.stringify(meta).includes('token'));
 const next=succeeded(await platform(path+'/reissue','POST',{})),token=new URL(next.activation_url).searchParams.get('token')!;assert.equal((await activate(m.invite.token)).status,400);
 succeeded(await platform(path+'/revoke','POST',{}));assert.equal((await activate(token)).status,400);
 const final=succeeded(await platform(path+'/reissue','POST',{}));succeeded(await activate(new URL(final.activation_url).searchParams.get('token')!));assert.equal((await platform(path+'/reissue','POST',{})).code,'OWNER_ALREADY_ACTIVATED');assert.equal((await platform(path+'/revoke','POST',{})).code,'OWNER_ALREADY_ACTIVATED');
});
test('activation and reissue serialize and never create two owners',async()=>{
 const m=await create(),path='/merchants/'+m.merchant.id+'/invite';const [activation,reissue]=await Promise.all([activate(m.invite.token),platform(path+'/reissue','POST',{})]);
 if(activation.status===200){assert.equal(reissue.code,'OWNER_ALREADY_ACTIVATED')}else{assert.equal(activation.status,400);const next=succeeded(reissue);succeeded(await activate(new URL(next.activation_url).searchParams.get('token')!))}
 const logged=succeeded(await h.call('/api/merchant/v1/auth/login','POST',{merchant_code:m.merchant.code,username:'owner',password}));assert.equal((await h.call('/api/platform/v1'+path,'GET',undefined,logged.token)).status,401);
});
