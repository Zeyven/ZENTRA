import {createPortal} from 'react-dom'
import {useAuth} from '../store/auth'
import {useEffect,useRef,useState} from 'react'
import {AsyncButton,Modal} from './ui'
import BrandMark from './BrandMark'
import {BRAND_NAME,BRAND_DESCRIPTION,BRAND_TAGLINE} from '../../../shared/brand'
export default function DesktopTools(){
 const user=useAuth(s=>s.user),[buttonHost,setButtonHost]=useState<HTMLElement|null>(null)
 useEffect(()=>{setButtonHost(user?document.getElementById('desktop-tools-entry'):null)},[user])
 const [open,setOpen]=useState(false),[info,setInfo]=useState<{name:string;version:string;appId:string;apiOrigin:string;channel:string}|null>(null),[state,setState]=useState<{status:string;version?:string;message?:string;percent?:number}>({status:'idle'}),[error,setError]=useState('')
 useEffect(()=>{if(!open||!window.saasDesktop)return;let disposed=false;void window.saasDesktop.info().then(v=>{if(!disposed)setInfo(v)}).catch(e=>{if(!disposed)setError(e.message)});return()=>{disposed=true}},[open])
 const dismissed=useRef(new Set<string>());const [notice,setNotice]=useState(false)
 useEffect(()=>{if(!window.saasDesktop)return;let disposed=false;const poll=()=>window.saasDesktop!.update('state').then(v=>{if(!disposed)setState(v)}).catch(e=>{if(!disposed)setError(e.message)});void poll();const timer=setInterval(()=>{if(document.visibilityState==='visible')void poll()},open?1500:5000);return()=>{disposed=true;clearInterval(timer)}},[open])
 useEffect(()=>{const key=state.version+':'+state.status;if(['available','downloaded'].includes(state.status)&&state.version&&!dismissed.current.has(key))setNotice(true);else setNotice(false)},[state.status,state.version])
 if(!window.saasDesktop)return null
 const action=async(kind:'check'|'download'|'install')=>{setError('');try{setState(await window.saasDesktop!.update(kind))}catch(e){setError(e instanceof Error?e.message:'客户端更新未完成')}}
 const labels:Record<string,string>={checking:'正在检查更新',idle:'等待自动检查更新',current:'当前已是此渠道的最新版本',available:'有可用更新',downloading:'正在下载更新',downloaded:'更新已下载',installing:'正在重启安装',error:'更新失败'}
 return <>{notice&&!open&&<div role="status" aria-label="客户端更新提醒" className="fixed bottom-16 right-4 z-40 max-w-sm rounded-xl border border-green-200 bg-white p-5 shadow-lg"><p className="font-semibold">{state.status==='downloaded'?'更新已下载':'发现新版本'} · {state.version}</p><p className="text-sm text-gray-500 my-3">完成当前业务后，可选择更新。软件不会自动重启。</p><div className="flex gap-3"><button className="btn-primary" onClick={()=>setOpen(true)}>查看更新</button><button className="btn-secondary" onClick={()=>{dismissed.current.add(state.version+':'+state.status);setNotice(false)}}>本次忽略</button></div></div>}{!user?<button className="fixed right-4 bottom-3 z-30 rounded-lg border bg-white px-3 py-2 text-xs text-gray-600 shadow-sm" onClick={()=>setOpen(true)}>客户端版本</button>:buttonHost?createPortal(<button className="btn-ghost w-full text-xs" onClick={()=>setOpen(true)}>版本与更新</button>,buttonHost):null}<Modal open={open} title={`${BRAND_NAME} 客户端`} onClose={()=>setOpen(false)} footer={<>
  <AsyncButton className="btn-secondary" disabled={['checking','downloading','downloaded','installing'].includes(state.status)} onClick={()=>action('check')}>检查更新</AsyncButton>
  {state.status==='available'&&<AsyncButton className="btn-primary" onClick={()=>action('download')}>下载更新</AsyncButton>}
  {state.status==='downloaded'&&<AsyncButton className="btn-primary" onClick={()=>action('install')}>重启并安装更新</AsyncButton>}
 </>}><div className="space-y-3"><div className="flex items-center gap-3"><BrandMark className="w-12 h-12"/><div><p className="font-semibold">{BRAND_DESCRIPTION}</p><p className="text-sm text-gray-500 mt-1">{BRAND_TAGLINE}</p></div></div><p className="text-xs text-gray-500">启动后自动检查，每 15 分钟检查一次；下载和安装由你确认。</p><p>当前版本：{info?.version??'读取中…'}</p><p role="status">{labels[state.status]??state.status}{state.version?' · '+state.version:''}</p>{state.status==='downloading'&&<p>下载进度：{Math.round(state.percent??0)}%</p>}{state.status==='downloaded'&&<p className="text-amber-700">请先保存当前业务操作，再重启客户端。</p>}{(error||state.message)&&<p role="alert" className="text-red-600 break-all">{error||state.message}</p>}</div></Modal></>
}
