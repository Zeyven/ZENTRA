import BrandMark from '../components/BrandMark'
import {BRAND_NAME} from '../../../shared/brand'
import {useCallback,useEffect,useRef,useState} from 'react'
import {getServerUrl} from '../api/transport'
import {fmtTime} from '../utils/format'
const labels:Record<string,string>={waiting:'等待叫号',called:'已叫号，请到前台',done:'已入座',cancelled:'已取消或过号'}
export default function PublicQueue(){
 const parts=location.pathname.split('/'),merchantCode=decodeURIComponent(parts[2]??''),storeCode=decodeURIComponent(parts[3]??'')
 const base=`${getServerUrl()}/api/public/v1/${encodeURIComponent(merchantCode)}/${encodeURIComponent(storeCode)}/queue`
 const storageKey=`za-spa-saas:public-queue:v1:${getServerUrl()}:${merchantCode}:${storeCode}`
 const [info,setInfo]=useState<any>(null),[ticket,setTicket]=useState<any>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)??'null')}catch{return null}})
 const [form,setForm]=useState({customer_name:'',people:1,phone:''}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false)
 const submitting=useRef(false),requestKey=useRef(crypto.randomUUID()),requestBody=useRef<string>()
 const load=useCallback(async(signal?:AbortSignal)=>{
  try{const response=await fetch(base,{signal,credentials:'omit'}),payload=await response.json();if(!response.ok||!payload.ok)throw Error(payload.message??'门店入口读取失败');setInfo(payload.data)
   if(ticket?.access_token){const r=await fetch(base+'/'+ticket.id,{signal,credentials:'omit',headers:{Authorization:'Bearer '+ticket.access_token}}),p=await r.json();if(!r.ok||!p.ok)throw Error(p.message??'排号读取失败');setTicket((old:any)=>({...old,...p.data}))}setError('')
  }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'网络连接失败')}
 },[base,ticket?.id,ticket?.access_token])
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);const timer=setInterval(()=>{if(document.visibilityState==='visible')void load(controller.signal)},10000);return()=>{controller.abort();clearInterval(timer)}},[load])
 async function take(){
  if(submitting.current)return
  if(!form.customer_name.trim()||!Number.isInteger(form.people)||form.people<1||form.people>1000){setError('请填写姓名和有效人数');return}
  submitting.current=true;setBusy(true);setError('');if(!requestBody.current)requestBody.current=JSON.stringify(form)
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000)
  try{const response=await fetch(base+'/take',{method:'POST',credentials:'omit',signal:controller.signal,headers:{'Content-Type':'application/json','Idempotency-Key':requestKey.current},body:requestBody.current}),payload=await response.json()
   if(!response.ok||!payload.ok){if(response.status<500){requestKey.current=crypto.randomUUID();requestBody.current=undefined;setUnknown(false)}else setUnknown(true);throw Error(payload.message??'取号失败，请使用原请求重试')}
   setTicket(payload.data);sessionStorage.setItem(storageKey,JSON.stringify(payload.data));setUnknown(false)
  }catch(e){if(e instanceof TypeError||controller.signal.aborted)setUnknown(true);setError(e instanceof Error?e.message:'结果未确认，请重试核对')}
  finally{clearTimeout(timeout);submitting.current=false;setBusy(false)}
 }
 return <main className="min-h-screen bg-slate-50 px-4 py-8"><section className="mx-auto max-w-md space-y-5"><div><div className="flex items-center gap-2"><BrandMark className="w-8 h-8"/><p className="text-sm text-gray-500">{BRAND_NAME} · 顾客自助取号</p></div><h1 className="mt-2 text-2xl font-bold">{info?.store.name??'正在读取门店…'}</h1></div>
 {info&&<div className="rounded-xl bg-sky-600 text-white p-5 flex justify-between"><div><p className="text-sm">当前叫号</p><b className="text-3xl">{info.summary.called_no??'—'}</b></div><div className="text-right"><b className="text-3xl">{info.summary.waiting_count}</b><p className="text-sm">组等待 · {info.summary.waiting_people} 人</p></div></div>}
 {error&&<p role="alert" className="rounded-lg bg-red-50 text-red-700 p-3">{error}</p>}
 {ticket?<div className="card p-6 text-center space-y-3"><p>您的排号</p><strong className="text-5xl text-sky-700">{ticket.queue_no}</strong><p role="status" className="font-semibold">{labels[ticket.status]??ticket.status}</p><p className="text-sm text-gray-500">{ticket.people} 位 · {fmtTime(ticket.created_at)} 取号</p><button className="btn-secondary" onClick={()=>void load()}>刷新状态</button></div>:info?.store.available?<form className="card p-5 space-y-4" onSubmit={e=>{e.preventDefault();void take()}}><fieldset disabled={busy||unknown} className="space-y-4"><label className="block"><span className="label">顾客姓名</span><input className="input" required maxLength={100} value={form.customer_name} onChange={e=>setForm({...form,customer_name:e.target.value})}/></label><label className="block"><span className="label">人数</span><input className="input" type="number" min={1} max={1000} required value={form.people} onChange={e=>setForm({...form,people:Number(e.target.value)})}/></label><label className="block"><span className="label">电话（选填）</span><input className="input" type="tel" maxLength={40} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label></fieldset>{unknown&&<p className="text-amber-700 text-sm">上次取号结果尚未确认。重试将核对同一请求。</p>}<button className="btn-primary w-full" disabled={busy}>{busy?'正在取号…':unknown?'重试并核对排号':'确认取号'}</button></form>:info&&<p role="status" className="card p-5">门店暂未接受新取号。</p>}
 <p className="text-xs text-gray-500 text-center">请保留此页面查看自己的排号。</p></section></main>
}
