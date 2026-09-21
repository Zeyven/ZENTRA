import {useCallback,useEffect,useRef,useState} from 'react'
import BrandMark from '../components/BrandMark'
import {BRAND_NAME} from '../../../shared/brand'
import {getServerUrl} from '../api/transport'
import {fmtDateTime,fmtMoney} from '../utils/format'

export default function PublicCoupons(){
 const parts=location.pathname.split('/'),base=`${getServerUrl()}/api/public/v1/${encodeURIComponent(decodeURIComponent(parts[2]??''))}/${encodeURIComponent(decodeURIComponent(parts[3]??''))}/coupons`,storage=`za-spa-saas:coupon-claim:v1:${base}`
 const [token]=useState(()=>{const value=new URLSearchParams(location.hash.slice(1)).get('claim');if(value&&/^[A-Za-z0-9_-]{43}$/.test(value)){sessionStorage.setItem(storage,value);return value}return sessionStorage.getItem(storage)||''})
 const [center,setCenter]=useState<any>(null),[invitation,setInvitation]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(()=>!!sessionStorage.getItem(storage+':request'))
 const locked=useRef(false),mounted=useRef(true),readController=useRef<AbortController|null>(null),readVersion=useRef(0)
 const request=useCallback(async(path:string,options:RequestInit={})=>{
  const response=await fetch(base+path,{...options,credentials:'omit',headers:{...(token?{Authorization:'Bearer '+token}:{}),...options.headers}}),payload=await response.json()
  if(!response.ok||!payload.ok)throw Object.assign(Error(payload.message??'领券服务暂不可用'),{status:response.status})
  return payload.data
 },[base,token])
 const load=useCallback(async()=>{
  readController.current?.abort();const controller=new AbortController(),version=++readVersion.current;readController.current=controller;const timer=setTimeout(()=>controller.abort(),20000)
  try{const [data,receipt]=await Promise.all([request('/center',{signal:controller.signal}),token?request('/invitation',{signal:controller.signal}):Promise.resolve(null)]);if(!mounted.current||version!==readVersion.current)return;setCenter(data);setInvitation(receipt);if(receipt?.claimed){sessionStorage.removeItem(storage+':request');setUnknown(false)}setError('')}
  catch(e){if(mounted.current&&version===readVersion.current)setError(controller.signal.aborted?'领券信息读取超时，请刷新重试':e instanceof Error?e.message:'领券信息读取失败')}
  finally{clearTimeout(timer)}
 },[request,storage,token])
 useEffect(()=>{mounted.current=true;if(location.hash)history.replaceState(null,'',location.pathname+location.search);void load();return()=>{mounted.current=false;readVersion.current++;readController.current?.abort()}},[load])
 async function claim(){
  if(locked.current)return;locked.current=true;readVersion.current++;readController.current?.abort();setBusy(true);setError('');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
  try{const key=sessionStorage.getItem(storage+':request')||crypto.randomUUID();sessionStorage.setItem(storage+':request',key);const result=await request('/claim',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','Idempotency-Key':key},body:'{}'});if(!mounted.current)return;setInvitation(result);sessionStorage.removeItem(storage+':request');setUnknown(false)}
  catch(e){if(!mounted.current)return;const known=(e as any)?.status&&(e as any).status<500;if(known)sessionStorage.removeItem(storage+':request');setUnknown(!known);setError(e instanceof Error&&e.name!=='AbortError'?e.message:'结果尚未确认，请沿用原请求核对')}
  finally{clearTimeout(timer);locked.current=false;if(mounted.current)setBusy(false)}
 }
 const coupon=invitation?.coupon??invitation?.campaign
 return <main className="min-h-screen bg-slate-50 p-5 sm:p-10"><section className="max-w-lg mx-auto space-y-5"><header className="flex items-center gap-3"><BrandMark/><div><p className="text-xs text-brand-700">{BRAND_NAME} · 领券中心</p><h1 className="text-2xl font-semibold mt-1">{center?.store.name??'门店领券'}</h1></div></header>{error&&<p role="alert" className="card p-4 text-red-600">{error}</p>}
 {coupon?<div className="card p-6 space-y-4"><p role="status" className="text-brand-700 font-semibold">{invitation.claimed?'优惠券已领取':'核验已完成，可领取优惠券'}</p><h2 className="text-xl font-semibold">{coupon.name}</h2><p className="text-4xl font-semibold">{coupon.type==='cash'?fmtMoney(coupon.value):`${Number(coupon.value)*10} 折`}</p><p>消费满 {fmtMoney(coupon.min_amount)} 可用</p>{invitation.claimed?<><p>券编号 #{coupon.id} · {coupon.status==='used'?'已使用':'已存入会员券包'}</p><p>有效期至 {fmtDateTime(coupon.expire_at)}</p></>:<><p>领取后 {coupon.expire_days} 天有效</p><button className="btn-primary w-full" disabled={busy||!center?.store.available} onClick={()=>void claim()}>{busy?'正在处理…':unknown?'核对原领取结果':'确认领取'}</button></>}</div>:!token&&center?<div className="space-y-4"><p className="card p-5 text-sm">请到店核验会员身份，向工作人员获取专属领券链接。手机号验证码接口尚未接入。</p>{center.items.map((item:any)=><div className="card p-5" key={item.id}><h2 className="font-semibold">{item.name}</h2><p>{item.type==='cash'?fmtMoney(item.value):`${Number(item.value)*10} 折`} · 满 {fmtMoney(item.min_amount)} 可用</p><p className="text-sm text-gray-500">剩余 {item.remaining} 份</p></div>)}{!center.items.length&&<p className="card p-5">暂无可领活动。</p>}</div>:null}
 <button className="btn-secondary" disabled={busy} onClick={()=>void load()}>刷新领券状态</button><p className="text-xs text-gray-500">每位会员每个活动限领一次，请妥善保管专属链接。</p></section></main>
}
