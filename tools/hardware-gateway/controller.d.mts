import type {GatewayLocalState,GatewayPairing} from '../../apps/client/src/shared/hardware';
export function createGatewayController(apiOrigin:string,options?:{allowTestLoopback?:boolean}):{
 start(input:GatewayPairing):Promise<GatewayLocalState>;
 stop(message?:string):Promise<GatewayLocalState>;
 check():Promise<GatewayLocalState>;
 state():GatewayLocalState;
};
