import {useAuth} from '../store/auth'
import {getServerUrl} from './transport'

export type RechargeJournal={version:1;memberId:number;recharge:{amount:number;bonus:number;times:number;plan_id?:number};method:string;key:string;signature:string}
export function rechargeJournalKey(){const s=useAuth.getState();if((s.realm!=='merchant'&&!['maintenance','platform_admin'].includes(s.support?.scope))||!s.merchant?.id||!s.user?.id||!s.currentStoreId)throw Error('请先登录并选择门店');return `za-spa-saas:pending-recharge:v1:${getServerUrl()}:${s.merchant.id}:${s.user.id}:${s.currentStoreId}${s.realm==='support'?':support:'+s.support?.id:''}`}
export function readRechargeJournal(key:string):RechargeJournal|null{
 const raw=localStorage.getItem(key);if(!raw)return null
 try{const r=JSON.parse(raw) as RechargeJournal
  if(r.version!==1||!Number.isSafeInteger(r.memberId)||r.memberId<=0||!r.recharge||![r.recharge.amount,r.recharge.bonus,r.recharge.times].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)||r.recharge.amount<=0||!Number.isSafeInteger(r.recharge.times)||r.recharge.plan_id!==undefined&&(!Number.isSafeInteger(r.recharge.plan_id)||r.recharge.plan_id<=0)||!['现金','微信','支付宝','银行卡'].includes(r.method)||typeof r.key!=='string'||!/^[a-f0-9-]{36}$/i.test(r.key)||r.signature!==JSON.stringify([r.memberId,r.recharge,r.method]))throw Error()
  return r
 }catch{throw Error('本机存在无法读取的待核对充值记录，请先联系管理员核对流水，不要重新收款')}
}
export async function saveRechargeJournal(scope:string,record:RechargeJournal){
 if(!navigator.locks)throw Error('当前浏览器不支持充值恢复锁，请使用受支持的客户端')
 await navigator.locks.request(scope,()=>{
  const old=readRechargeJournal(scope);if(old&&(old.key!==record.key||old.signature!==record.signature))throw Error('当前门店还有一笔充值待核对，请先恢复原请求')
  localStorage.setItem(scope,JSON.stringify(record))
 })
}
export function clearRechargeJournal(scope:string,key:string){if(readRechargeJournal(scope)?.key===key)localStorage.removeItem(scope)}
