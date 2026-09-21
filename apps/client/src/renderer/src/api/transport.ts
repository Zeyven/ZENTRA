import {io,type Socket} from 'socket.io-client'
import {useAuth} from '../store/auth'
import {bumpRealtime,setRealtimeConnected} from '../store/realtime'
const SERVER_KEY='za-spa-saas:server:v1',PREFIX='/api/merchant/v1'
const reads=new Map<string,Promise<any>>(),writes=new Map<string,Promise<any>>(),retryKeys=new Map<string,string>(),controllers=new Set<AbortController>()
let socket:Socket|null=null,refreshTimer:ReturnType<typeof setTimeout>|undefined,lastEpoch=useAuth.getState().epoch
let observedCursor=0
let desktopApiOrigin:string|undefined
export async function initializeDesktop(){if(window.saasDesktop){const info=await window.saasDesktop.info();if(info.appId!=='cn.zephael.zaspa.saas')throw Error('客户端身份无效');desktopApiOrigin=safeServer(info.apiOrigin)}}
const savedOrders=new Map<number,{order:any;at:number}>()
export const orderVersions=new Map<number,number>()
export function invalidate(){if(!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=undefined;bumpRealtime()},100)}
function discard(){setRealtimeConnected(false);for(const controller of controllers)controller.abort('Session changed');controllers.clear();reads.clear();writes.clear();retryKeys.clear();socket?.disconnect();socket=null;if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=undefined;orderVersions.clear();savedOrders.clear();observedCursor=0}
useAuth.subscribe(state=>{if(state.epoch!==lastEpoch){lastEpoch=state.epoch;discard()}})
function safeServer(value:string){const url=new URL(value);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('远程服务器必须使用 HTTPS');return url.origin}
export function getServerUrl(){if(desktopApiOrigin)return desktopApiOrigin;const saved=localStorage.getItem(SERVER_KEY);if(saved)return safeServer(saved);const configured=import.meta.env.VITE_SAAS_API_URL;if(configured)return safeServer(configured);return ['file:','zaspa-saas:'].includes(location.protocol)?'https://saas.zephael.cn':location.origin}
export function setServerUrl(value:string){const target=safeServer(value);if(target!==getServerUrl()){useAuth.getState().clearSession();localStorage.setItem(SERVER_KEY,target)}}
export interface RemoteFailure{ok:false;msg:string;code?:string;pending_approval?:boolean;approval_id?:number}
export function isRemoteFailure(value:any):value is RemoteFailure{return value?.ok===false}
export function rememberOrder(order:any){if(Number.isSafeInteger(order?.id)&&Number.isSafeInteger(order?.version)){orderVersions.set(order.id,Math.max(orderVersions.get(order.id)??0,order.version));if(Array.isArray(order.items)&&Number.isSafeInteger(order.event_cursor)){const previous=savedOrders.get(order.id);if(!previous||previous.order.version<=order.version)savedOrders.set(order.id,{order:structuredClone(order),at:Date.now()})}}return order}
export function cachedOrder(id:number){const value=savedOrders.get(id);return value&&value.order.event_cursor>=observedCursor&&Date.now()-value.at<30000?structuredClone(value.order):null}
export function expectedVersion(id:number){const version=orderVersions.get(id);if(!version)throw Error('请先读取订单，再执行操作');return version}
function observe(data:any){if(Array.isArray(data)){for(const row of data)if(row?.order_no)rememberOrder(row)}else if(data?.order)rememberOrder(data.order);else if(data?.order_no)rememberOrder(data);if(data?.resources)for(const room of data.resources)if(room.session_id)orderVersions.set(room.session_id,Math.max(orderVersions.get(room.session_id)??0,room.session_version))}
export function remote<T=any>(path:string,options:RequestInit={}):Promise<T>{
 if(!path.startsWith(PREFIX+'/')&&path!==PREFIX)throw Error('拒绝旧协议或其他身份入口')
 const state=useAuth.getState(),method=options.method??'GET',isRead=method==='GET',key=JSON.stringify([getServerUrl(),state.epoch,method,path,options.body,options.headers]),map=isRead?reads:writes
 const existing=map.get(key);if(existing&&!options.signal)return existing
 const request=perform<T>(path,options,key).finally(()=>{if(map.get(key)===request)map.delete(key)});if(!options.signal)map.set(key,request);return request
}
async function perform<T>(path:string,options:RequestInit,key:string):Promise<T>{
 const state=useAuth.getState(),epoch=state.epoch,method=options.method??'GET',isRead=method==='GET',anonymous=path.includes('/auth/login')||path.includes('/auth/activate')
 const controller=new AbortController();controllers.add(controller);const abort=()=>controller.abort(options.signal?.reason);if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true})
 const timeout=setTimeout(()=>controller.abort('Request timeout'),isRead?15000:30000)
 const tenantOnly=/^\/(stores|users|support|catalog)(\/|$)/.test(path.slice(PREFIX.length))
 const headers=new Headers(options.headers);headers.set('Accept','application/json');if(options.body)headers.set('Content-Type','application/json');if(!anonymous&&state.token)headers.set('Authorization','Bearer '+state.token);if(!anonymous&&!tenantOnly&&state.currentStoreId&&!headers.has('X-Store-ID'))headers.set('X-Store-ID',String(state.currentStoreId))
 if(!isRead&&!anonymous&&!headers.has('Idempotency-Key')){const body=typeof options.body==='string'?JSON.parse(options.body||'{}'):{};const value=body.request_key??retryKeys.get(key)??crypto.randomUUID();retryKeys.set(key,value);headers.set('Idempotency-Key',value)}
 try{
  const response=await fetch(getServerUrl()+path,{...options,headers,signal:controller.signal,credentials:'omit'})
  const payload=await response.json();if(useAuth.getState().epoch!==epoch)throw new DOMException('已丢弃旧账号或门店响应','AbortError')
  if(response.status===401&&!anonymous)useAuth.getState().clearSession()
  if(!response.ok||payload.ok!==true){
   if(!isRead&&response.status>=500)return {ok:false,msg:'服务响应异常，结果尚未确认。请核对原请求，勿重复提交或收款。',code:'RESULT_UNKNOWN'} as T
   if(response.status<500)retryKeys.delete(key);const failure={ok:false as const,msg:payload.message??'操作失败',code:payload.code,...(payload.pending_approval?{pending_approval:true,approval_id:payload.approval_id}:{})}
   if(isRead)throw Object.assign(Error(failure.msg),{status:response.status,code:failure.code});return failure as T
  }
  const data=payload.data;observe(data);if(!isRead){retryKeys.delete(key);if(!anonymous)invalidate();return (data&&typeof data==='object'&&!Array.isArray(data)?{...data,ok:true}:{ok:true,data}) as T}
  return data as T
 }catch(error){
  if(useAuth.getState().epoch!==epoch||options.signal?.aborted)throw error
  if(isRead)throw error
  return {ok:false,msg:controller.signal.aborted?'请求超时，结果尚未确认。请核对记录或使用原请求重试。':error instanceof Error?error.message:'网络请求失败',code:'RESULT_UNKNOWN'} as T
 }finally{clearTimeout(timeout);controllers.delete(controller);options.signal?.removeEventListener('abort',abort)}
}
export async function subscribeRealtime(onChange:(event?:any)=>void):Promise<()=>void>{
 socket?.disconnect();const state=useAuth.getState(),epoch=state.epoch;if(!state.currentStoreId||!state.token)return ()=>undefined
 const cursorKey=`za-spa-saas:cursor:v1:${state.merchant?.id}:${state.user?.id}:${state.currentStoreId}`;let cursor=Number(sessionStorage.getItem(cursorKey)??0),disposed=false
 const current=io(getServerUrl(),{path:'/socket.io',transports:['websocket','polling'],auth:{token:state.token,store_id:state.currentStoreId,protocol_version:1}});socket=current
 const active=()=>!disposed&&useAuth.getState().epoch===epoch
 current.on('data.changed',value=>{if(!active()||value.merchant_id!==state.merchant?.id||value.store_id!==state.currentStoreId||value.id<=cursor)return;cursor=value.id;observedCursor=Math.max(observedCursor,cursor);sessionStorage.setItem(cursorKey,String(cursor));invalidate();onChange({event:'changed',topics:value.topics})})
 current.on('connect',()=>{if(!active())return;savedOrders.clear();void (async()=>{let after=cursor,more=true;while(active()&&more){const result=await remote<any>(PREFIX+'/realtime/events?after='+after);if(!active())return;after=result.next_cursor;more=result.has_more;observedCursor=Math.max(observedCursor,after)}if(active()){cursor=Math.max(cursor,after);sessionStorage.setItem(cursorKey,String(cursor));invalidate();onChange({event:'recovered'})}})().catch(()=>{if(active())onChange({event:'connection-error'})})})
 current.on('access.revoked',()=>{if(!active())return;setRealtimeConnected(false);void remote<any>(PREFIX+'/session',{headers:{'X-Store-ID':''}}).then(session=>{if(!active())return;const preferred=state.currentStoreId;if(preferred&&session.stores.some((store:any)=>store.id===preferred))session.current_store_id=preferred;useAuth.getState().setBootstrap(session);invalidate();onChange({event:'changed',topics:['access.changed']})}).catch(error=>{if(!active())return;if(error.status===401||error.status===403)useAuth.getState().clearSession();else onChange({event:'connection-error'})})})
 current.on('access.changed',value=>{if(active()&&value.merchant_id===state.merchant?.id){invalidate();onChange({event:'changed',topics:['access.changed']})}})
 current.on('connect',()=>{if(active())setRealtimeConnected(true)})
 current.on('connect_error',()=>{if(active())onChange({event:'connection-error'})})
 current.on('disconnect',()=>{if(active()){setRealtimeConnected(false);onChange({event:'disconnected'})}})
 return ()=>{disposed=true;current.disconnect();if(socket===current)socket=null}
}
