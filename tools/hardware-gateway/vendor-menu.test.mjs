import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPointClockMenuJson,parseVendorResources,selectPointClockMenuFragments} from './vendor-menu.mjs';

test('vendor menu follows business root, 7-inch child and numeric action order',()=>{
 const raw=JSON.stringify([
  {saasId:'root-foot',parentId:'',title:'FOOT',sortOrder:'1',url:'{}'},
  {saasId:'root-bath',parentId:'',title:'BATH',sortOrder:'1',url:'{}'},
  {saasId:'panel-7',parentId:'root-foot',title:'7寸点钟王',sortOrder:'1',url:'{}'},
  {saasId:'other',parentId:'root-foot',title:'4.3寸点钟王',sortOrder:'1',url:'{}'},
  {saasId:'late',parentId:'panel-7',title:'下钟',sortOrder:'10',url:'{"funid":"end"}'},
  {saasId:'early',parentId:'panel-7',title:'报钟',sortOrder:'2.5',url:'{"funid":"start"}'},
  {saasId:'foreign',parentId:'other',title:'无关',sortOrder:'0',url:'{"funid":"foreign"}'}
 ]);
 const fragments=selectPointClockMenuFragments(parseVendorResources(raw),'FOOT');
 assert.deepEqual(fragments,['{"funid":"start"}','{"funid":"end"}']);
 assert.equal(buildPointClockMenuJson(fragments),'[{"funid":"start"},{"funid":"end"}]');
});

test('vendor menu fails closed on absent hierarchy and non-JSON actions',()=>{
 assert.throws(()=>selectPointClockMenuFragments([], 'FOOT'));
 assert.throws(()=>buildPointClockMenuJson(['not-json']));
 const root={saasId:'root',parentId:'',title:'FOOT',sortOrder:'1',url:'{}'};
 const panel={saasId:'panel',parentId:'root',title:'7寸点钟王',sortOrder:'1',url:'{}'};
 const action={saasId:'action',parentId:'panel',title:'查询',sortOrder:'1',url:'{"funid":"read"}'};
 assert.throws(()=>selectPointClockMenuFragments([root,{...root,saasId:'another'},panel,action],'FOOT'),/ambiguous/);
 assert.throws(()=>selectPointClockMenuFragments([root,panel,{...panel,saasId:'panel2'},action],'FOOT'),/ambiguous/);
 assert.throws(()=>selectPointClockMenuFragments([{...root,saasId:''},panel,action],'FOOT'),/root ID is missing/);
 assert.throws(()=>selectPointClockMenuFragments([root,{...panel,saasId:''},action],'FOOT'),/menu ID is missing/);
});
