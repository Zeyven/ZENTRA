import type {HardwareInventory,GatewayPairing,GatewayLocalState} from '../../shared/hardware';
export {};
declare global{interface Window{saasDesktop?:{
 gateway:(action:'state'|'start'|'stop'|'check',pairing?:GatewayPairing)=>Promise<GatewayLocalState>;
 detectHardware:()=>Promise<HardwareInventory>;
 info:()=>Promise<{name:string;version:string;appId:string;apiOrigin:string;channel:string}>;
 print:()=>Promise<{printed:boolean}>;
 update:(action:'state'|'check'|'download'|'install')=>Promise<{status:string;version?:string;message?:string}>;
}}}
