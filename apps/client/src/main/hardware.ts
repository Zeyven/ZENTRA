import {createHmac,randomBytes} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {execFile} from 'node:child_process';
import {createServer,isIPv4} from 'node:net';
import {join} from 'node:path';
import type {HardwareInventory} from '../shared/hardware';
export const privateIPv4=(s:string)=>isIPv4(s)&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(s);
// Fixed, read-only commands. No renderer-provided shell strings or vendor credentials.
const inventorySalt=randomBytes(32);
const inventoryScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$warnings=@(); $devices=@(); $neighbors=@(); $panelCandidates=@(); $vendor=@{cacheFound=$false;menuFound=$false;menuResourceCount=0;authorizedDeviceCount=0;authorizedDevices=@();rollBellKingConfig=$null}
try { $devices=@(Get-PnpDevice -PresentOnly | Where-Object { $_.Class -in @('Keyboard','Ports','HIDClass') -or $_.InstanceId -like 'USB\*' } | Select-Object -First 256 | ForEach-Object {
 $kind='usb';if($_.Class -eq 'Keyboard'){$kind='keyboard'};if($_.Class -eq 'Ports'){$kind='serial'}
 $port='';if($_.FriendlyName -match '\bCOM\d+\b'){$port=$Matches[0]}
 $vidPid='';if($_.InstanceId -match 'VID_[0-9A-F]{4}&PID_[0-9A-F]{4}'){$vidPid=$Matches[0]}
 @{instance=[string]$_.InstanceId;name=[string]$_.FriendlyName;kind=$kind;status=[string]$_.Status;port=$port;vidPid=$vidPid}
}) } catch {$warnings+= 'USB/serial inventory unavailable'}
try { $neighbors=@(Get-NetNeighbor -AddressFamily IPv4 | Where-Object {$_.State -in @('Reachable','Stale','Permanent')} | Select-Object -First 256 | ForEach-Object {@{address=[string]$_.IPAddress;interfaceIndex=[int]$_.InterfaceIndex;state=[string]$_.State}}) } catch {$warnings+='Neighbor inventory unavailable'}
try { $panelCandidates=@(Get-NetTCPConnection -LocalPort 8032 -State Established | Select-Object -First 256 | ForEach-Object {@{address=[string]$_.RemoteAddress;localAddress=[string]$_.LocalAddress;localPort=[int]$_.LocalPort}}) } catch {}
try {
 $cache=Get-Item -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Eissoft\HARD\Cache' -ErrorAction Stop
 $vendor.cacheFound=$true
 try {
  $raw=[string]$cache.GetValue('SaasTenantResource',$null,'DoNotExpandEnvironmentNames')
  if($raw){$parsed=$raw|ConvertFrom-Json -ErrorAction Stop;$vendor.menuFound=$true;if($parsed -is [array]){$vendor.menuResourceCount=[Math]::Min(100000,@($parsed).Count)}}
 } catch {$warnings+='检测到思软菜单缓存，但内容无法安全解析'}
 try {
  $raw=[string]$cache.GetValue('RollBellKingConfig',$null,'DoNotExpandEnvironmentNames')
  if($raw.Length -le 4194304){$vendor.rollBellKingConfig=$raw}else{$warnings+='思软点钟王绑定缓存过大，已忽略'}
 } catch {}
} catch {}
try {
 $local=Get-Item -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Eissoft\HARD\LOCAL' -ErrorAction Stop
 $vendor.authorizedDevices=@($local.GetValueNames()|Where-Object {$_ -match '^[0-9A-Fa-f]{32}$' -and ([string]$local.GetValue($_,$null,'DoNotExpandEnvironmentNames')).Length -eq 32}|Select-Object -First 100)
 $vendor.authorizedDeviceCount=$vendor.authorizedDevices.Count
} catch {}
@{devices=$devices;neighbors=$neighbors;panelCandidates=$panelCandidates;vendor=$vendor;warnings=$warnings}|ConvertTo-Json -Depth 5 -Compress
`;
export function parseInventory(output:string):Pick<HardwareInventory,'devices'|'neighbors'|'panelCandidates'|'vendor'|'warnings'>{
 const x=JSON.parse(output.replace(/^\uFEFF/,''));
 if(!x||!Array.isArray(x.devices)||!Array.isArray(x.neighbors)||!Array.isArray(x.warnings))throw Error('Invalid hardware inventory');
 const devices=x.devices.slice(0,256).filter((d:any)=>d&&['keyboard','serial','usb'].includes(d.kind)&&typeof d.name==='string').map((d:any)=>({id:typeof d.instance==='string'?createHmac('sha256',inventorySalt).update(d.instance).digest('hex'):undefined,name:d.name.slice(0,200),kind:d.kind,status:String(d.status??'Unknown').slice(0,40),port:/^COM\d+$/.test(d.port)?d.port:undefined,vidPid:/^VID_[\dA-F]{4}&PID_[\dA-F]{4}$/i.test(d.vidPid)?d.vidPid:undefined}));
 const neighbors=x.neighbors.slice(0,256).filter((n:any)=>n&&privateIPv4(n.address)&&Number.isInteger(n.interfaceIndex)).map((n:any)=>({address:n.address,interfaceIndex:n.interfaceIndex,state:String(n.state).slice(0,30)}));
 const rawCandidates:unknown[]=Array.isArray(x.panelCandidates)?x.panelCandidates:[],candidateMap=new Map<string,{address:string;localAddress:string;localPort:number}>();
 for(const value of rawCandidates.slice(0,256)){const c=value as any;if(c&&privateIPv4(c.address)&&privateIPv4(c.localAddress)&&c.localPort===8032&&c.address!==c.localAddress)candidateMap.set(c.address,{address:c.address,localAddress:c.localAddress,localPort:8032})}
 const panelCandidates=[...candidateMap.values()];
 const v=x.vendor??{},rawAuthorized:unknown[]=Array.isArray(v.authorizedDevices)?v.authorizedDevices:[],authorizedDevices:string[]=[...new Set(rawAuthorized.filter((id):id is string=>typeof id==='string'&&/^[0-9a-f]{32}$/i.test(id)).map(id=>id.toLowerCase()))].slice(0,100),bindings=extractVendorBindings(v.rollBellKingConfig,authorizedDevices),vendor={cacheFound:v.cacheFound===true,menuFound:v.menuFound===true,menuResourceCount:Number.isSafeInteger(v.menuResourceCount)&&v.menuResourceCount>=0?Math.min(v.menuResourceCount,100000):0,authorizedDeviceCount:authorizedDevices.length,authorizedDevices,bindings};
 return {devices,neighbors,panelCandidates,vendor,warnings:x.warnings.map((w:any)=>String(w).slice(0,200))};
}
export async function portAvailable(host:string,port:number):Promise<boolean>{
 if(host==='0.0.0.0'){
  // Windows permits a wildcard bind alongside an existing address-specific bind.
  const addresses=new Set(['127.0.0.1',...Object.values(networkInterfaces()).flatMap(items=>(items??[]).filter(i=>i.family==='IPv4').map(i=>i.address))]);
  for(const address of addresses)if(!await portAvailable(address,port))return false;
 }
 return new Promise(resolve=>{const server=createServer();server.once('error',()=>resolve(false));server.listen({host,port,exclusive:true},()=>server.close(()=>resolve(true)));});}
let pending:Promise<HardwareInventory>|null=null;
export async function detectHardware():Promise<HardwareInventory>{
 if(pending)return pending;
 pending=(async()=>{
  const interfaces=Object.entries(networkInterfaces()).flatMap(([name,items])=>(items??[]).filter(i=>i.family==='IPv4'&&!i.internal&&privateIPv4(i.address)).map(i=>({name,address:i.address,netmask:i.netmask})));
  let inventory:Pick<HardwareInventory,'devices'|'neighbors'|'panelCandidates'|'vendor'|'warnings'>={devices:[],neighbors:[],panelCandidates:[],vendor:{cacheFound:false,menuFound:false,menuResourceCount:0,authorizedDeviceCount:0,authorizedDevices:[],bindings:[]},warnings:[]};
  if(process.platform==='win32'){
   try{const output=await new Promise<string>((resolve,reject)=>execFile(join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(inventoryScript,'utf16le').toString('base64')],{windowsHide:true,timeout:20000,maxBuffer:1024*1024,encoding:'utf8'},(error,stdout)=>error?reject(error):resolve(stdout)));inventory=parseInventory(output)}catch{inventory.warnings.push('本机设备枚举失败或超时，请检查 Windows 设备管理服务后重试。')}
  }else inventory.warnings.push('USB、串口自动检测目前仅支持 Windows。');
  const ports=await Promise.all([18032,18034,18035].map(async port=>({port,available:await portAvailable('0.0.0.0',port)})));
  return {scannedAt:new Date().toISOString(),interfaces,...inventory,ports};
 })();try{return await pending}finally{pending=null}
}

export function extractVendorBindings(raw:unknown,authorizedDevices:string[]):HardwareInventory['vendor']['bindings']{
 if(typeof raw!=='string'||!raw||raw.length>4*1024*1024)return [];
 let root:unknown;try{root=JSON.parse(raw)}catch{return []}
 const authorized=new Set(authorizedDevices.map(id=>id.toLowerCase())),found=new Map<string,{deviceId:string;roomNo:string;panelIp:string}|null>(),stack:[unknown,number][]=[[root,0]];
 while(stack.length){const [value,depth]=stack.pop()!;if(depth>8)continue;if(Array.isArray(value)){for(const child of value.slice(0,10000))stack.push([child,depth+1]);continue}if(!value||typeof value!=='object')continue;const row=value as Record<string,unknown>,id=typeof row.rollBellKingId==='string'?row.rollBellKingId.toLowerCase():'',room=typeof row.roomName==='string'?row.roomName.trim():'',panelIp=typeof row.switchIp==='string'?row.switchIp:'';
  if(row.type===2&&row.deleteFlag===0&&row.roomEnableStatus===0&&authorized.has(id)&&room.length>0&&room.length<=40&&/^[^\u0000-\u001f\u007f]+$/.test(room)&&privateIPv4(panelIp)){const next={deviceId:id,roomNo:room,panelIp},old=found.get(id);found.set(id,old===undefined?next:old&&old.roomNo===room&&old.panelIp===panelIp?old:null)}
  for(const child of Object.values(row).slice(0,1000))stack.push([child,depth+1]);
 }
 const candidates=[...found.values()].filter((x):x is {deviceId:string;roomNo:string;panelIp:string}=>x!==null),roomCounts=new Map<string,number>(),ipCounts=new Map<string,number>();
 for(const binding of candidates){roomCounts.set(binding.roomNo,(roomCounts.get(binding.roomNo)??0)+1);ipCounts.set(binding.panelIp,(ipCounts.get(binding.panelIp)??0)+1)}
 return candidates.filter(binding=>roomCounts.get(binding.roomNo)===1&&ipCounts.get(binding.panelIp)===1).slice(0,100);
}
