import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVendorRuntimeOutput} from './vendor-runtime.mjs';

const id='0123456789abcdef0123456789abcdef',code='authorized-registration-code-000';
const menu=JSON.stringify([{saasId:'r',parentId:'',title:'FOOT',sortOrder:'1',url:'{}'}]);

test('vendor runtime keeps authorized material in a bounded main-process structure',()=>{
 const result=parseVendorRuntimeOutput(JSON.stringify({menu,registrations:{[id]:code},tenantName:'测试门店',servicePhone:'4000000000'}),[id]);
 assert.equal(result.registrations.get(id),code);assert.equal(result.resources[0].title,'FOOT');assert.equal(result.tenantName,'测试门店');
});

test('vendor runtime rejects missing, unexpected and malformed authorization',()=>{
 const base={menu,tenantName:'测试门店',servicePhone:''};
 assert.throws(()=>parseVendorRuntimeOutput(JSON.stringify({...base,registrations:{}}),[id]));
 assert.throws(()=>parseVendorRuntimeOutput(JSON.stringify({...base,registrations:{[id]:code,ffffffffffffffffffffffffffffffff:code}}),[id]));
 assert.throws(()=>parseVendorRuntimeOutput(JSON.stringify({...base,registrations:{[id]:'short'}}),[id]));
 assert.throws(()=>parseVendorRuntimeOutput(JSON.stringify({menu,registrations:{[id]:code},tenantName:'',servicePhone:''}),[id]));
});
