import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {sessionItem} from '../apps/server/src/services/orders.js';
const {roomServices,serviceStatus}=createRequire(import.meta.url)('../apps/client/src/renderer/src/utils/room-operations.ts');
test('room clock view preserves pause and awaiting acceptance and excludes refunded services',()=>{
 const base={id:1,item_type:'service',item_name:'按摩',status:'active',technician_id:1,duration:60,clock_paused_seconds:300,clock_in_at:'2026-09-18T00:00:00Z',clock_paused_at:'2026-09-18T00:15:00Z'};
 const paused=roomServices([sessionItem(base)])[0];assert.equal(serviceStatus(paused,Date.parse('2026-09-19T00:00:00Z')).label,'已暂停');
 const waiting=roomServices([sessionItem({...base,clock_in_at:null,clock_paused_at:null})])[0];assert.equal(serviceStatus(waiting).state,'ASSIGNED');
 assert.equal(roomServices([sessionItem({...base,is_refund:1}),sessionItem({...base,item_type:'product'})]).length,0);
 const running=roomServices([sessionItem({...base,clock_paused_at:null})])[0];
 assert.equal(serviceStatus(running,Date.parse('2026-09-18T01:00:00Z')).label,'剩余 5 分钟');
 assert.equal(serviceStatus(running,Date.parse('2026-09-18T01:06:00Z')).label,'已到时 · 超时 1 分钟');
 assert.equal(serviceStatus({...running,state:'unexpected'}).state,'UNKNOWN');
});
