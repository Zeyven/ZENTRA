import {AnnouncerDraft} from './announcer.js';

export function announcerReadiness(connection: {model?:string;transport?:string;announcer_config?:unknown}|null) {
 const missing:string[]=[];
 if(!connection)return {configured:false,missing:['保存本店播报器配置'],businessReady:false as const};
 if(!connection.model?.trim())missing.push('填写品牌型号');
 const parsed=AnnouncerDraft.safeParse(connection.announcer_config??{});
 if(!parsed.success)missing.push('修正播报配置格式');
 else {
  const c=parsed.data;
  if(!connection.transport||connection.transport==='unknown')missing.push('确认连接方式');
  if(c.protocol==='unknown')missing.push('确认厂商通信协议');
  if(!c.address)missing.push('填写设备或网关地址');
  if(['tcp','udp','http','mqtt'].includes(c.protocol)&&!c.port)missing.push('填写通信端口');
  if(!c.terminal_id)missing.push('填写终端编号');
  if(connection.transport==='network'&&c.protocol==='serial'||connection.transport==='serial'&&['tcp','udp','http','mqtt'].includes(c.protocol))missing.push('连接方式与协议不一致');
 }
 return {configured:true,missing,businessReady:false as const};
}

export function gatewayReadiness(g:{revoked_at?:string|null;expires_at:string;last_seen_at?:string|null},now=Date.now()) {
 if(g.revoked_at)return {state:'revoked',label:'授权已撤销',fresh:false} as const;
 const expiry=Date.parse(g.expires_at);
 if(!Number.isFinite(expiry)||expiry<=now)return {state:'expired',label:'授权已过期或到期信息无效',fresh:false} as const;
 const seen=Date.parse(g.last_seen_at??'');
 if(!Number.isFinite(seen))return {state:'unseen',label:'尚未收到网关心跳',fresh:false} as const;
 if(seen>now+5000)return {state:'clock_error',label:'心跳时间异常，请检查时钟',fresh:false} as const;
 if(now-seen>=90000)return {state:'offline',label:'网关心跳已过期',fresh:false} as const;
 return {state:'online',label:'网关在线，设备业务未验收',fresh:true} as const;
}
