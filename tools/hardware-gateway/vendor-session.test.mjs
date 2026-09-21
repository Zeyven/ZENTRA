import test from 'node:test';
import assert from 'node:assert/strict';
import {loadVendorSession} from './vendor-session.mjs';

const deviceId='0123456789abcdef0123456789abcdef';
const devices=[{deviceId}];
const session={point_clock_business_type:'FOOT'};
const runtime={tenantName:'测试门店',servicePhone:'4000000000',registrations:new Map([[deviceId,'authorized-registration-code-000']]),resources:[
 {saasId:'root',parentId:'',title:'FOOT',sortOrder:'1',url:'{}'},
 {saasId:'seven',parentId:'root',title:'7寸点钟王',sortOrder:'1',url:'{}'},
 {saasId:'start',parentId:'seven',title:'报钟',sortOrder:'1',url:'{"funid":"start"}'},
]};

test('loads only a complete local vendor runtime for an explicitly configured business type',async()=>{
 let received=[];
 const result=await loadVendorSession(session,devices,async ids=>{received=ids;return runtime});
 assert.equal(result.vendor.businessType,'FOOT');
 assert.equal(result.vendor.runtime,runtime);assert.deepEqual(received,[deviceId]);
 assert.match(result.message,/自动载入/);
});

test('does not invoke a vendor runtime reader for missing business type or non-vendor identifier',async()=>{
 let calls=0;const read=async()=>{calls++;return runtime};
 assert.equal((await loadVendorSession({},devices,read)).vendor,null);
 assert.equal((await loadVendorSession(session,[{deviceId:'local-test-panel'}],read)).vendor,null);
 assert.equal(calls,0);
});

test('does not expose local authorization details when cache reading or menu validation fails',async()=>{
 const failure=await loadVendorSession(session,devices,async()=>{throw Error('registration value')});
 assert.deepEqual(failure,{vendor:null,message:'；原厂授权或当前业态的菜单不完整，点钟王登录未启用'});
 const incomplete=await loadVendorSession(session,devices,async()=>({...runtime,registrations:new Map()}));
 assert.equal(incomplete.vendor,null);
});
