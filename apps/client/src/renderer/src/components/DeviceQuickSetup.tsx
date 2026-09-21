import {useEffect,useRef,useState} from 'react'
import {AnnouncerDraft} from '@za-spa/contracts'
import type {HardwareInventory} from '../../../shared/hardware'
import {remote,isRemoteFailure} from '../api/transport'
type Choice='wristband_reader'|'technician_announcer'
const labels:Record<Choice,string>={wristband_reader:'手牌刷牌器',technician_announcer:'技师房报钟器'}
export default function DeviceQuickSetup({inventory,disabled,onPending}:{inventory:HardwareInventory;disabled:boolean;onPending:(v:boolean)=>void}){
 const [rows,setRows]=useState<any[]|null>(null),[selected,setSelected]=useState<Record<Choice,string>>({wristband_reader:'',technician_announcer:''}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[confirmed,setConfirmed]=useState(false),[saved,setSaved]=useState<any[]|null>(null),[loading,setLoading]=useState(true),[loadFailed,setLoadFailed]=useState(false)
 useEffect(()=>{onPending(busy||unknown)},[busy,unknown,onPending])
 const loadLock=useRef(false),mounted=useRef(false)
 const lock=useRef(false),pending=useRef<{body:any;key:string}|null>(null)
 async function reload(){
  if(loadLock.current)return;loadLock.current=true;setLoading(true);setLoadFailed(false);setRows(null);setConfirmed(false);setSaved(null);setError('')
  try{const r=await remote<any[]>('/api/merchant/v1/devices');if(mounted.current)setRows(r);return true}
  catch{if(mounted.current){setLoadFailed(true);setError('读取现有配置失败，尚未更改配置。请重新读取，无需重新检测设备。')}}
  finally{loadLock.current=false;if(mounted.current)setLoading(false)}
 }
 useEffect(()=>{mounted.current=true;void reload();return()=>{mounted.current=false}},[])

 const entries=(Object.keys(labels) as Choice[]).flatMap(kind=>{const index=selected[kind];if(index==='')return [];const d=inventory.devices[Number(index)],old=rows?.find(r=>r.kind===kind);if(!d)return [];return [{kind,version:old?.version??0,name:old?.name??labels[kind],model:d.name.slice(0,100),transport:d.kind==='keyboard'?'keyboard':d.kind==='serial'?'serial':'usb',...(kind==='technician_announcer'?{announcer_config:{...AnnouncerDraft.parse(old?.announcer_config??{}),address:d.port??'',port:null,protocol:'unknown'}}:{})}]})
 const replaces=entries.some(e=>rows?.some(r=>r.kind===e.kind))
 async function apply(){if(lock.current||disabled)return;if(!unknown){if(loading||!rows||!entries.length||(replaces&&!confirmed))return;pending.current={body:{devices:entries},key:crypto.randomUUID()}}const request=pending.current;if(!request)return;lock.current=true;setBusy(true);setError('');try{const r=await remote<any>('/api/merchant/v1/devices/configure',{method:'POST',body:JSON.stringify(request.body),headers:{'Idempotency-Key':request.key}});if(isRemoteFailure(r)){setUnknown(r.code==='RESULT_UNKNOWN');setError(r.msg);if(r.code==='VERSION_CONFLICT'){const refreshed=await reload();if(mounted.current){setConfirmed(false);if(refreshed)setError('其他终端已修改配置，已读取最新内容。请重新核对并确认后保存。')}}return}setSaved(r.devices);setRows(old=>[...(old??[]).filter(r=>!request.body.devices.some((d:any)=>d.kind===r.kind)),...r.devices]);setUnknown(false);pending.current=null;setConfirmed(false)}catch{setUnknown(true);setError('保存结果尚未确认，请核对原请求；不要重新创建配置。')}finally{lock.current=false;setBusy(false)}}
 return <section aria-label="一键保存设备配置" className="border rounded p-4 space-y-3"><h4 className="font-semibold">选择用途，一键保存配置</h4><p className="text-sm">从检测结果选择实际设备，自动填写名称和连接方式；报钟器草稿可带入已检测到的串口。刷牌器专用串口驱动仍待适配，不会自动启用未知协议。</p>
 {loading&&<p role="status">正在读取本店现有配置…</p>}{loadFailed&&<button className="btn-secondary" disabled={disabled||busy||unknown||loading} onClick={()=>void reload()}>重新读取现有配置</button>}
 <fieldset disabled={disabled||busy||unknown||loading||!rows} className="space-y-3">{(Object.keys(labels) as Choice[]).map(kind=><label className="block" key={kind}>{labels[kind]}<select aria-label={'一键配置'+labels[kind]} className="input w-full" value={selected[kind]} onChange={e=>{setSelected({...selected,[kind]:e.target.value});setSaved(null);setConfirmed(false);setError('')}}><option value="">不配置此类设备</option>{inventory.devices.map((d,i)=>d.status==='OK'&&(kind==='wristband_reader'||d.kind!=='keyboard')?<option key={d.id??i} value={String(i)} disabled={Object.entries(selected).some(([k,v])=>k!==kind&&v===String(i))}>{d.name} · {d.port??d.vidPid??d.kind} · 候选项 {i+1}</option>:null)}</select></label>)}
 {rows&&entries.map(e=><div className="rounded border p-2 text-sm" key={e.kind}><p>{labels[e.kind]}：{e.model} · {e.transport}{'announcer_config' in e?' · '+e.announcer_config?.address:''}</p><p>{rows?.some(r=>r.kind===e.kind)?'将更新本店已有配置':'将新增本店配置'}；{e.kind==='technician_announcer'?'保存为待厂商适配草稿，不会向实体设备播报':e.transport==='keyboard'?'键盘输入模式；保存后请在读卡检测框刷卡确认':'专用驱动尚未适配，不会自动接通设备'}</p></div>)}
 {replaces&&<label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>已核对，允许更新以上已有配置</label>}</fieldset>
 <button className="btn-primary" disabled={disabled||busy||(!unknown&&(!rows||!entries.length||(replaces&&!confirmed)||!!saved))} onClick={()=>void apply()}>{busy?'正在保存…':unknown?'核对原配置结果':'一键保存所选配置'}</button>
 {unknown&&<p className="text-amber-700">结果未确认时请留在本页核对，不要重新检测或退出。</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}{saved&&<div role="status"><p>已保存 {saved.length} 项配置。设备连接与业务测试尚未验证。</p><p>刷牌器请在下方输入检测框刷卡；点钟王请继续下方网关房间绑定；报钟器等待厂商适配后试播。</p></div>}
 </section>
}
