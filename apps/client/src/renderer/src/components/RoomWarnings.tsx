import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { toast } from '../store/toast'
import { uuid } from '../utils/uuid'

type Warning = {id:number;room_id:number;message:string;created_at:number;expires_at:number;acknowledged_at:number|null;acknowledged_by:number|null;cancelled_at:number|null}
type Snapshot = {server_now:number;can_send:boolean;rooms:{id:number;room_no:string}[];warnings:Warning[]}
export default function RoomWarnings({ roomId }: {roomId?:string}): JSX.Element {
  const receiver=roomId!==undefined
  const [data,setData]=useState<Snapshot|null>(null), [error,setError]=useState(''), [target,setTarget]=useState(''), [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false), [voice,setVoice]=useState(false), [,tick]=useState(0)
  const clock=useRef({server:0,mono:0}), pending=useRef(new Map<string,string>()), spoken=useRef(new Set<number>()), sequence=useRef(0), mounted=useRef(true)
  const sending=useRef(false)
  const broadcastKey=useRef<string|null>(null)
  const loading=useRef<Promise<void>|null>(null), refreshAgain=useRef(false)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++}},[])
  const load=useCallback(():Promise<void>=>{
    if(loading.current){refreshAgain.current=true;return loading.current}
    // Coalesce overlapping polls; a slow valid response must still be applied.
    // A trailing refresh observes mutations that happened during this request.
    loading.current=(async()=>{
        refreshAgain.current=false
        const seq=++sequence.current
        try {
          const result=await api.roomWarnings()
          if(!mounted.current||seq!==sequence.current)return
          if(!Array.isArray(result.warnings)||!Array.isArray(result.rooms)||!Number.isFinite(result.server_now))throw new Error('警告同步响应无效')
          clock.current={server:result.server_now,mono:performance.now()};setData(result);setError('')
        }catch(e){if(mounted.current&&seq===sequence.current)setError(e instanceof Error?e.message:'警告同步失败')}
    })().finally(()=>{
      loading.current=null
      if(refreshAgain.current&&mounted.current)void load()
    })
    return loading.current
  },[])
  useAutoRefresh(load,3000,{pollWhenConnected:true})
  useEffect(()=>{const id=setInterval(()=>tick(n=>n+1),1000);return()=>clearInterval(id)},[])
  const now=clock.current.server+performance.now()-clock.current.mono
  const stale=Boolean(error)||!data||performance.now()-clock.current.mono>10000
  const active=(data?.warnings||[]).filter(w=>!w.acknowledged_at&&!w.cancelled_at&&w.expires_at>now&&String(w.room_id)===roomId)
  useEffect(()=>{
    if(!receiver||!voice||stale||!roomId||!('speechSynthesis' in window))return
    for(const warning of active){
      if(spoken.current.has(warning.id))continue
      spoken.current.add(warning.id)
      const utter=new SpeechSynthesisUtterance(`前台警告，${warning.message}`);utter.lang='zh-CN'
      window.speechSynthesis.speak(utter)
    }
  },[data,voice,stale,roomId])
  useEffect(()=>()=>{if(receiver&&'speechSynthesis' in window)window.speechSynthesis.cancel()},[roomId,receiver])
  async function act(id:number, action:'acknowledge'|'cancel'):Promise<void>{
    if(sending.current||busy||stale)return
    sending.current=true;setBusy(true)
    try{await api.roomWarningAction(id,action);await load()}catch(e){toast(e instanceof Error?e.message:'警告操作失败','error')}finally{sending.current=false;setBusy(false)}
  }
  async function send(content=message):Promise<void>{
    if(sending.current||busy||stale||!target||!content.trim())return
    const signature=JSON.stringify([target,content.trim()]),key=pending.current.get(signature)||uuid()
    sending.current=true;pending.current.set(signature,key);setBusy(true)
    try{await api.sendRoomWarning(Number(target),content.trim(),key);pending.current.delete(signature);if(content===message)setMessage('');toast('警告已保存，等待人员确认；不代表硬件已响铃');await load()}
    catch(e){toast(e instanceof Error?e.message:'发送结果未确认，请重试','error')}finally{sending.current=false;setBusy(false)}
  }
  async function broadcast():Promise<void>{
    if(sending.current||busy||stale)return
    sending.current=true;setBusy(true)
    const key=broadcastKey.current||uuid();broadcastKey.current=key
    try{const result=await api.broadcastRoomWarning(key);broadcastKey.current=null;toast(`全店预警已保存，覆盖 ${result.room_count} 个房间，等待人员确认`);await load()}
    catch(e){toast(e instanceof Error?e.message:'全店预警未确认，请重试','error')}finally{sending.current=false;setBusy(false)}
  }
  if(receiver)return <section aria-label="房间警告接收" className="my-3">
    <button className="btn-secondary" disabled={!roomId} onClick={()=>{if(!('speechSynthesis' in window)){toast('浏览器不支持语音','error');return}setVoice(!voice);if(voice)window.speechSynthesis.cancel();else{const sample=new SpeechSynthesisUtterance('警告声音已开启，请确认房间扬声器可以听到。');sample.lang='zh-CN';sample.onerror=()=>toast('声音播放失败，请检查设备音量和浏览器权限','error');window.speechSynthesis.speak(sample)}}}>{voice?'关闭警告语音':'开启警告语音'}</button>
    <span className="text-xs ml-3">{stale?'警告连接未确认，请联系前台':roomId?'接收当前所选房间警告':'先选择本房间，才会显示房间警告'}</span>
    {active.length>0&&<div role="alertdialog" aria-label="前台房间警告" aria-modal="false" className="fixed inset-x-4 top-20 z-50 max-h-[75vh] overflow-y-auto border-4 border-red-600 rounded-xl bg-red-50 p-6 shadow-xl">
      <h2 className="text-2xl font-bold text-red-700">前台房间警告</h2>
      {active.map(w=><div className="border-t border-red-200 py-4" key={w.id}><p className="text-xl whitespace-pre-wrap break-words">{w.message}</p><button className="btn-primary mt-3" disabled={busy||stale} onClick={()=>void act(w.id,'acknowledge')}>我已看到 · 确认 #{w.id}</button></div>)}
      <p className="text-xs">{stale?'当前离线，无法提交确认。请用电话联系前台。':'点击确认会记录当前登录人员；不是设备自动签收。'}</p>
    </div>}
  </section>
  return <section aria-label="房间警告通知" className="mx-5 my-3 rounded-lg border bg-white p-3"><h3 className="font-semibold">房间警告通知</h3>
    {data?.can_send&&<div className="flex flex-wrap gap-3 items-center my-3"><button className="rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold px-6 py-3 disabled:opacity-50" disabled={busy||stale} onClick={()=>void broadcast()}>全店一键预警</button><span className="text-xs text-gray-500">立即通知当前门店所有启用房间（包括空闲房），无需选房或填写内容，不跨门店。</span></div>}
    <p className="text-xs my-2">有效期 30 分钟。已保存不等于已到达；人员确认后才显示已确认。不能代替消防或生命安全报警。</p>
    {stale&&<p role="alert" className="text-red-700">{error||'正在连接警告服务'}</p>}
    {data?.can_send&&<details><summary className="text-sm cursor-pointer">自定义警告内容</summary><div className="flex flex-wrap gap-2 my-3"><select aria-label="警告目标房间" className="input w-36" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="">选择房间</option>{data.rooms.map(r=><option key={r.id} value={r.id}>{r.room_no} 房</option>)}</select><input aria-label="房间警告内容" className="input flex-1 min-w-48" maxLength={200} value={message} disabled={busy} onChange={e=>setMessage(e.target.value)} placeholder="如：请房间人员立即联系前台"/><button className="btn-primary" disabled={busy||stale||!target||!message.trim()} onClick={()=>void send()}>发送房间警告</button></div></details>}
    <details className="mt-2"><summary className="text-xs text-gray-500 cursor-pointer">查看预警记录</summary><div className="max-h-64 overflow-y-auto mt-2">{data?.warnings.map(w=><div key={w.id} className="border-t py-2 text-sm"><strong>{data.rooms.find(r=>r.id===w.room_id)?.room_no} 房</strong> · {w.message}<span className="ml-3">{w.acknowledged_at?`已由账号 #${w.acknowledged_by} 确认`:w.cancelled_at?'已撤销':w.expires_at<=now?'已过期（未确认）':'待人员确认'}</span>{!w.acknowledged_at&&!w.cancelled_at&&w.expires_at>now&&data.can_send&&<button className="btn-ghost ml-2" disabled={busy||stale} onClick={()=>void act(w.id,'cancel')}>撤销 #{w.id}</button>}</div>)}</div></details>
  </section>
}
