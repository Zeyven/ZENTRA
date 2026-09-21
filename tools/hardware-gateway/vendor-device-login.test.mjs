import test from 'node:test';
import assert from 'node:assert/strict';
import {createVendorDeviceLogin,validatePointClockVendorRuntime,vendorDateTime} from './vendor-device-login.mjs';

const deviceId='0123456789abcdef0123456789abcdef';
const registration='authorized-registration-code-000';
const runtime={tenantName:'测试门店',servicePhone:'4000000000',registrations:new Map([[deviceId,registration]]),resources:[
 {saasId:'root',parentId:'',title:'FOOT',sortOrder:'1',url:'{}'},
 {saasId:'seven',parentId:'root',title:'7寸点钟王',sortOrder:'1',url:'{}'},
 {saasId:'start',parentId:'seven',title:'报钟',sortOrder:'1',url:'{"funid":"start"}'}
]};

test('device login reproduces vendor fields, constants, menu array and signature',()=>{
 const date=new Date(2026,8,15,9,8,7),result=createVendorDeviceLogin({deviceId,roomName:'203',businessType:'FOOT',runtime,date});
 assert.equal(vendorDateTime(date),'2026-09-15 09:08:07');
 assert.deepEqual(result.data.menu,[{funid:'start'}]);assert.equal(result.data.exittime,20);assert.equal(result.data.freshtime,30);assert.equal(result.data.outtime,10);
 assert.equal(result.data.company,'测试门店');assert.equal(result.data.support,'4000000000');assert.equal(result.data.roomname,'203');assert.match(result.data.regsn,/^[0-9a-f]{32}$/);
});

test('device login rejects unprovisioned device and absent business menu',()=>{
 assert.throws(()=>createVendorDeviceLogin({deviceId:'f'.repeat(32),roomName:'203',businessType:'FOOT',runtime}));
 assert.throws(()=>createVendorDeviceLogin({deviceId,roomName:'203',businessType:'BATH',runtime}));
});

test('startup rejects a readable vendor cache without the authorized business menu',()=>{
 assert.doesNotThrow(()=>validatePointClockVendorRuntime(runtime,'FOOT',[deviceId]));
 assert.throws(()=>validatePointClockVendorRuntime(runtime,'BATH',[deviceId]),/missing or ambiguous/);
 assert.throws(()=>validatePointClockVendorRuntime(runtime,'FOOT',[deviceId,'f'.repeat(32)]),/authorization is incomplete/);
 assert.throws(()=>validatePointClockVendorRuntime({...runtime,resources:runtime.resources.slice(0,2)},'FOOT',[deviceId]),/no actions/);
});
