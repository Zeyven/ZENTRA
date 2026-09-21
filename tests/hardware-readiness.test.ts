import {test} from 'node:test';
import assert from 'node:assert/strict';
import {announcerReadiness,gatewayReadiness} from '../packages/contracts/src/hardware-readiness.js';
test('saved and complete announcer drafts never claim hardware delivery',()=>{
 assert.equal(announcerReadiness(null).configured,false);
 const r=announcerReadiness({model:'Test box',transport:'network',announcer_config:{protocol:'tcp',address:'192.168.10.20',port:8032,terminal_id:'test'}});
 assert.deepEqual(r.missing,[]);assert.equal(r.businessReady,false);
});
test('announcer checks missing ports, invalid data and contradictory transports',()=>{
 assert.ok(announcerReadiness({transport:'network',announcer_config:{protocol:'tcp'}}).missing.includes('填写通信端口'));
 assert.ok(announcerReadiness({transport:'network',announcer_config:{protocol:'serial'}}).missing.includes('连接方式与协议不一致'));
 assert.ok(announcerReadiness({announcer_config:{port:70000}}).missing.includes('修正播报配置格式'));
});
test('revocation and expiry override even a recent connected heartbeat',()=>{
 const now=Date.parse('2026-09-14T00:00:00Z'),g={expires_at:new Date(now+1000).toISOString(),last_seen_at:new Date(now).toISOString()};
 assert.equal(gatewayReadiness(g,now).fresh,true);
 assert.equal(gatewayReadiness({...g,revoked_at:g.last_seen_at},now).state,'revoked');
 assert.equal(gatewayReadiness(g,now+1000).state,'expired');
 assert.equal(gatewayReadiness({...g,expires_at:'invalid'},now).fresh,false);
});
test('stale and malformed heartbeat cannot be shown as a current connection',()=>{
 const now=Date.parse('2026-09-14T00:00:00Z'),g={expires_at:new Date(now+1000000).toISOString()};
 assert.equal(gatewayReadiness(g,now).state,'unseen');
 assert.equal(gatewayReadiness({...g,last_seen_at:new Date(now-90000).toISOString()},now).state,'offline');
 assert.equal(gatewayReadiness({...g,last_seen_at:new Date(now+6000).toISOString()},now).state,'clock_error');
});
