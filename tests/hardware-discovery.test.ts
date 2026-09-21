import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
const {parseInventory,privateIPv4,portAvailable}=createRequire(import.meta.url)('../apps/client/src/main/hardware.ts');
test('hardware inventory keeps only bounded device metadata and private IPv4 neighbors',()=>{
 const cache=JSON.stringify({rows:[{type:2,deleteFlag:0,roomEnableStatus:0,rollBellKingId:'ABCDEF0123456789ABCDEF0123456789',roomName:'203',switchIp:'192.168.10.33',registrationCode:'must-not-pass'},{type:2,deleteFlag:0,roomEnableStatus:0,rollBellKingId:'bad',roomName:'204',switchIp:'192.168.10.34'}]});
 const r=parseInventory(JSON.stringify({devices:[{name:'USB keyboard',kind:'keyboard',status:'OK',serialNumber:'private',vidPid:'VID_1234&PID_ABCD'},{name:'Serial (COM3)',kind:'serial',port:'COM3',status:'OK'},{name:'bad',kind:'command'}],neighbors:[{address:'192.168.10.33',interfaceIndex:1,state:'Stale'},{address:'8.8.8.8',interfaceIndex:1},{address:'192.168.10.1;command',interfaceIndex:1}],panelCandidates:[{address:'192.168.10.33',localAddress:'192.168.10.254',localPort:8032},{address:'8.8.8.8',localAddress:'192.168.10.254',localPort:8032},{address:'192.168.10.34',localAddress:'192.168.10.254',localPort:9999}],vendor:{authorizedDeviceCount:99,authorizedDevices:['ABCDEF0123456789ABCDEF0123456789','bad','abcdef0123456789abcdef0123456789'],rollBellKingConfig:cache,secret:'must-not-pass'},warnings:[]}));
 assert.equal(r.devices.length,2);assert.equal(r.devices[1].port,'COM3');assert.equal(r.devices[0].serialNumber,undefined);assert.deepEqual(r.neighbors,[{address:'192.168.10.33',interfaceIndex:1,state:'Stale'}]);assert.throws(()=>parseInventory('{}'));
 assert.deepEqual(r.vendor.authorizedDevices,['abcdef0123456789abcdef0123456789']);assert.equal(r.vendor.authorizedDeviceCount,1);assert.equal((r.vendor as any).secret,undefined);
 assert.deepEqual(r.vendor.bindings,[{deviceId:'abcdef0123456789abcdef0123456789',roomNo:'203',panelIp:'192.168.10.33'}]);assert.ok(!JSON.stringify(r).includes('registrationCode'));
 assert.deepEqual(r.panelCandidates,[{address:'192.168.10.33',localAddress:'192.168.10.254',localPort:8032}]);
 for(const ip of ['0.0.0.0','127.0.0.1','172.32.0.1','192.168.1.999'])assert.equal(privateIPv4(ip),false);
});
test('port detection rejects an occupied listener and releases its own test listener',async()=>{
 const server=createServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port;
 try{assert.equal(await portAvailable('0.0.0.0',port),false)}finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
 assert.equal(await portAvailable('0.0.0.0',port),true);assert.equal(await portAvailable('0.0.0.0',port),true);
});
test('conflicting vendor room bindings fail closed instead of selecting an arbitrary room',()=>{
 const deviceId='abcdef0123456789abcdef0123456789';
 const rollBellKingConfig=JSON.stringify({rows:[
  {type:2,deleteFlag:0,roomEnableStatus:0,rollBellKingId:deviceId,roomName:'203',switchIp:'192.168.10.254'},
  {type:2,deleteFlag:0,roomEnableStatus:0,rollBellKingId:deviceId,roomName:'205',switchIp:'192.168.10.254'}
 ]});
 const r=parseInventory(JSON.stringify({devices:[],neighbors:[],vendor:{authorizedDevices:[deviceId],rollBellKingConfig},warnings:[]}));
 assert.deepEqual(r.vendor.bindings,[]);
});
test('duplicate vendor room or panel IP is not auto-bound across device IDs',()=>{
 const a='a'.repeat(32),b='b'.repeat(32),c='c'.repeat(32),d='d'.repeat(32);
 const rollBellKingConfig=JSON.stringify({rows:[
  {type:2,deleteFlag:0,roomEnableStatus:0,rollBellKingId:a,roomName:'201',switchIp:'192.168.10.31'},
  {type:2,deleteFlag:0,roomEnableStatus:0,rollBellKingId:b,roomName:'201',switchIp:'192.168.10.32'},
  {type:2,deleteFlag:0,roomEnableStatus:0,rollBellKingId:c,roomName:'203',switchIp:'192.168.10.33'},
  {type:2,deleteFlag:0,roomEnableStatus:0,rollBellKingId:d,roomName:'204',switchIp:'192.168.10.33'}
 ]});
 const r=parseInventory(JSON.stringify({devices:[],neighbors:[],vendor:{authorizedDevices:[a,b,c,d],rollBellKingConfig},warnings:[]}));
 assert.deepEqual(r.vendor.bindings,[]);
});
test('deleted, disabled and non-7-inch vendor rows are not restored as active bindings',()=>{
 const ids=['1','2','3'].map(x=>x.repeat(32)),rows=[
  {type:2,deleteFlag:1,roomEnableStatus:0,rollBellKingId:ids[0],roomName:'201',switchIp:'192.168.10.31'},
  {type:2,deleteFlag:0,roomEnableStatus:1,rollBellKingId:ids[1],roomName:'202',switchIp:'192.168.10.32'},
  {type:1,deleteFlag:0,roomEnableStatus:0,rollBellKingId:ids[2],roomName:'203',switchIp:'192.168.10.33'}
 ];
 const r=parseInventory(JSON.stringify({devices:[],neighbors:[],vendor:{authorizedDevices:ids,rollBellKingConfig:JSON.stringify({rows})},warnings:[]}));
 assert.deepEqual(r.vendor.bindings,[]);
});
const {buildGatewaySuggestion,compareDevices,sameSubnet,selectGatewayHost}=createRequire(import.meta.url)('../apps/client/src/shared/hardware.ts');
test('gateway suggestion uses the vendor-confirmed panel IP and selects its only matching subnet',()=>{
 const base={scannedAt:'2026-09-15T00:00:00.000Z',interfaces:[{name:'office',address:'10.0.0.2',netmask:'255.255.255.0'},{name:'panels',address:'192.168.10.254',netmask:'255.255.255.0'}],devices:[],neighbors:[],ports:[],warnings:[],vendor:{cacheFound:true,menuFound:true,menuResourceCount:1,authorizedDeviceCount:1,authorizedDevices:['d'.repeat(32)],bindings:[{deviceId:'d'.repeat(32),roomNo:'203',panelIp:'192.168.10.33'}]}};
 const exact=buildGatewaySuggestion({...base,panelCandidates:[{address:'192.168.10.33',localAddress:'192.168.10.254',localPort:8032}]},'192.168.10.254',18032);
 assert.equal(exact.bindings[0].panelIp,'192.168.10.33');
 const ambiguous=buildGatewaySuggestion({...base,panelCandidates:[{address:'192.168.10.33',localAddress:'192.168.10.254',localPort:8032},{address:'192.168.10.34',localAddress:'192.168.10.254',localPort:8032}]},'192.168.10.254',18032);
 assert.equal(ambiguous.bindings[0].panelIp,'192.168.10.33');assert.deepEqual(ambiguous.panelCandidates,['192.168.10.33','192.168.10.34']);
 assert.equal(selectGatewayHost({...base,panelCandidates:[]}), '192.168.10.254');
});
test('同名设备按匿名标识区分，状态变化不冒充新插入，旧客户端保留重复数量',()=>{
 const a={id:'a',name:'同名刷牌器',kind:'usb',status:'OK'},b={...a,id:'b'};
 const diff=compareDevices([a,b],[{...a,status:'Error'},{...b,id:'c'}]);assert.deepEqual(diff.added.map((d:any)=>d.id),['c']);assert.deepEqual(diff.removed.map((d:any)=>d.id),['b']);assert.deepEqual(diff.changed.map((d:any)=>d.id),['a']);
 const legacy={name:'same',kind:'usb',status:'OK'};assert.equal(compareDevices([legacy,legacy],[legacy]).removed.length,1);
});
test('匿名标识稳定但不包含原设备实例路径，串口变化可以对应原设备',()=>{
 const raw={devices:[{name:'reader',kind:'serial',port:'COM3',status:'OK',instance:'USB\\VID_1234&PID_5678\\private-serial'}],neighbors:[],warnings:[]};
 const a=parseInventory(JSON.stringify(raw));raw.devices[0].port='COM4';const b=parseInventory(JSON.stringify(raw));assert.equal(a.devices[0].id,b.devices[0].id);assert.match(a.devices[0].id,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(a).includes('private-serial'));assert.equal(compareDevices(a.devices,b.devices).changed.length,1);
});
test('邻居筛选使用真实掩码并排除自身、广播、网络地址和畸形参数',()=>{
 assert.equal(sameSubnet('192.168.11.33','192.168.10.254','255.255.254.0'),true);
 for(const ip of ['192.168.12.33','192.168.10.254','192.168.10.0','192.168.11.255','bad'])assert.equal(sameSubnet(ip,'192.168.10.254','255.255.254.0'),false);
 assert.equal(sameSubnet('192.168.10.33','192.168.10.254','255.0.255.0'),false);assert.equal(sameSubnet('192.168.10.33','192.168.10.254','0.0.0.0'),false);
});
