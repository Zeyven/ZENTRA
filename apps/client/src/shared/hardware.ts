export interface HardwareInventory {
 scannedAt:string;
 interfaces:{name:string;address:string;netmask:string}[];
 devices:{id?:string;name:string;kind:'keyboard'|'serial'|'usb';status:string;port?:string;vidPid?:string}[];
 neighbors:{address:string;interfaceIndex:number;state:string}[];
 panelCandidates:{address:string;localAddress:string;localPort:number}[];
 ports:{port:number;available:boolean}[];
 vendor:{cacheFound:boolean;menuFound:boolean;menuResourceCount:number;authorizedDeviceCount:number;authorizedDevices:string[];bindings:{deviceId:string;roomNo:string;panelIp:string}[]};
 warnings:string[];
}
export interface GatewaySuggestion {host:string;port:number;deviceIds:string[];bindings:{deviceId:string;roomNo:string;panelIp:string}[];panelCandidates:string[]}

export function buildGatewaySuggestion(inventory:HardwareInventory,host:string,port:number):GatewaySuggestion{
 const panelCandidates=[...new Set(inventory.panelCandidates.filter(c=>c.localAddress===host).map(c=>c.address))];
 return {host,port,deviceIds:inventory.vendor.authorizedDevices,bindings:inventory.vendor.bindings,panelCandidates};
}

export function selectGatewayHost(inventory:HardwareInventory,currentHost=''){
 if(inventory.interfaces.some(i=>i.address===currentHost))return currentHost;
 const matched=inventory.vendor.bindings.length?inventory.interfaces.filter(i=>inventory.vendor.bindings.every(b=>sameSubnet(b.panelIp,i.address,i.netmask))):[];
 return matched.length===1?matched[0].address:inventory.interfaces.length===1?inventory.interfaces[0].address:'';
}

export type DetectedDevice=HardwareInventory['devices'][number];
export function compareDevices(previous:DetectedDevice[],current:DetectedDevice[]){
 const key=(d:DetectedDevice)=>d.id??JSON.stringify([d.name,d.kind,d.port??'',d.vidPid??'']);
 const remaining=[...previous],added:DetectedDevice[]=[],changed:DetectedDevice[]=[];
 for(const d of current){const index=remaining.findIndex(old=>key(old)===key(d));if(index<0)added.push(d);else{const old=remaining.splice(index,1)[0];if(old.status!==d.status||old.port!==d.port||old.name!==d.name)changed.push(d)}}
 return {added,removed:remaining,changed};
}
export function sameSubnet(address:string,host:string,mask:string){
 const parse=(s:string)=>{if(!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(s))return null;const n=s.split('.').map(Number);if(n.some(x=>x>255))return null;return n.reduce((a,b)=>(a*256+b)>>>0,0)};
 const ip=parse(address),local=parse(host),netmask=parse(mask);
 if(ip===null||local===null||netmask===null||netmask===0)return false;
 const inverted=(~netmask)>>>0;if((inverted&(inverted+1))!==0)return false;
 const network=(local&netmask)>>>0,broadcast=(network|inverted)>>>0;
 return ip!==local&&ip!==network&&ip!==broadcast&&((ip&netmask)>>>0)===network;
}
export interface GatewayPairing {apiOrigin:string;listenHost:string;port:number;storeId:number;token:string;devices:{ip:string;deviceId:string;roomNo:string;roomId:number}[]}
export interface GatewayLocalState {status:'stopped'|'starting'|'running'|'degraded';message:string;storeId?:number;host?:string;port?:number;devices:{device_id:string;state:string}[]}
