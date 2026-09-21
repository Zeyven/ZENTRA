import {useCallback,useRef,useState} from 'react'
import {AnnouncerDraft,announcerReadiness} from '@za-spa/contracts'
import {remote,isRemoteFailure} from '../api/transport'
import {useAuth,canWriteBusiness} from '../store/auth'
import {canOperate} from '../utils/permissions'
import {useAutoRefresh} from '../hooks/useAutoRefresh'
import {AsyncButton} from './ui'

const path='/api/merchant/v1/devices/technician_announcer'
export default function TechnicianAnnouncer({suggestion}:{suggestion?:{name:string;transport:string;port?:string}|null}){
 const user=useAuth(s=>s.user)!,realm=useAuth(s=>s.realm),merchant=useAuth(s=>s.merchant)
 const writable=canWriteBusiness()&&canOperate(user,'settingsManage')
 const [row,setRow]=useState<any>(null),[loaded,setLoaded]=useState(false),[form,setForm]=useState<any>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false)
 const pending=useRef<{body:any;key:string}|null>(null),lock=useRef(false)
 const load=useCallback(async()=>{const result=await remote<any>(path);setRow(result.connection);setLoaded(true)},[])
 useAutoRefresh(load)
 async function save(){
  if(lock.current||!writable)return
  if(!unknown){
   const config=AnnouncerDraft.safeParse(form.announcer_config)
   if(!config.success){setError(config.error.issues.map(i=>i.message).join('；'));return}
   if(!form.name.trim()){setError('请填写设备名称');return}
   pending.current={body:{...form,announcer_config:config.data},key:crypto.randomUUID()}
  }
  const request=pending.current;if(!request)return;lock.current=true;setBusy(true);setError('')
  try{
   const result=await remote<any>(path,{method:'PUT',body:JSON.stringify(request.body),headers:{'Idempotency-Key':request.key}})
   if(isRemoteFailure(result)){setUnknown(result.code==='RESULT_UNKNOWN');setError(result.msg);return}
   setRow(result);setUnknown(false);pending.current=null;setForm(null);setNotice('播报器配置草稿已保存；尚未连接硬件，排钟不会自动向设备播报。')
  }catch(e){setUnknown(true);setError(e instanceof Error?e.message:'保存结果尚未确认')}finally{lock.current=false;setBusy(false)}
 }
 const readiness=announcerReadiness(row)
 function config(key:string,value:unknown){setForm({...form,announcer_config:{...form.announcer_config,[key]:value}})}
 return <section className="card p-5 space-y-3" aria-label="技师房播报器配置">
  <div className="flex justify-between gap-3"><h3 className="font-semibold">技师房叫号播报器</h3><span className="text-sm text-amber-700">接口预留 · 未连接</span></div>
  <p className="text-sm text-gray-500">用于将排钟叫号播报到技师休息室。当前仅保存本店接入草稿，需取得厂商协议并完成适配后启用。现有叫钟按钮只在当前电脑发声，不会发送到此设备。</p>
  <p className="text-sm">{row?`${row.name} · ${row.model||'型号待定'}`:loaded?'尚未配置':'正在读取…'}</p>
  {suggestion&&!form&&<div className="border rounded p-3"><p>检测候选：{suggestion.name} · {suggestion.port??suggestion.transport}</p><button className="btn-secondary" disabled={!loaded||!writable} onClick={()=>{setForm({version:row?.version??0,name:row?.name??'技师房播报器',model:suggestion.name,transport:suggestion.transport,announcer_config:{...AnnouncerDraft.parse(row?.announcer_config??{}),protocol:'unknown',address:suggestion.port??'',port:null}});setError('');setNotice('检测信息已填入草稿，请核对设备和通信协议后保存。')}}>应用检测到的报钟器资料</button></div>}
  {!form&&<button className="btn-secondary" disabled={!loaded||!writable} onClick={()=>{setForm({version:row?.version??0,name:row?.name??'技师房播报器',model:row?.model??'',transport:row?.transport??'unknown',announcer_config:AnnouncerDraft.parse(row?.announcer_config??{})});setError('');setNotice('')}}>配置技师房播报器</button>}
  {form&&<><fieldset disabled={busy||unknown||!writable} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
   <label>设备名称<input className="input w-full" maxLength={100} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
   <label>品牌型号<input className="input w-full" maxLength={100} value={form.model} onChange={e=>setForm({...form,model:e.target.value})}/></label>
   <label>预期连接方式<select className="input w-full" value={form.transport} onChange={e=>setForm({...form,transport:e.target.value})}>{[['unknown','待确认'],['network','局域网 / 网关'],['serial','串口'],['usb','USB']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
   <label>预期通信协议<select className="input w-full" value={form.announcer_config.protocol} onChange={e=>config('protocol',e.target.value)}>{[['unknown','待厂商确认'],['tcp','TCP'],['udp','UDP'],['http','HTTP'],['mqtt','MQTT'],['serial','串口协议']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
   <label>{form.transport==='serial'?'串口名称':'设备或网关地址'}<input className="input w-full" maxLength={253} placeholder={form.transport==='serial'?'例如 COM3，需厂商串口协议':'例如 192.168.1.50；不填密码'} value={form.announcer_config.address} onChange={e=>config('address',e.target.value)}/></label>
   {form.transport==='network'&&<label>通信端口<input className="input w-full" type="number" min={1} max={65535} value={form.announcer_config.port??''} onChange={e=>config('port',e.target.value===''?null:Number(e.target.value))}/></label>}
   <label>终端编号<input className="input w-full" maxLength={100} value={form.announcer_config.terminal_id} onChange={e=>config('terminal_id',e.target.value)}/></label>
   <label>播报区域<input className="input w-full" maxLength={100} value={form.announcer_config.zone} onChange={e=>config('zone',e.target.value)}/></label>
   <label>重复次数<input className="input w-full" type="number" min={1} max={3} value={form.announcer_config.repeats} onChange={e=>config('repeats',Number(e.target.value))}/></label>
   <label>音量（0–100）<input className="input w-full" type="number" min={0} max={100} value={form.announcer_config.volume} onChange={e=>config('volume',Number(e.target.value))}/></label>
   <label className="sm:col-span-2">播报文案<textarea className="input w-full" maxLength={300} value={form.announcer_config.template} onChange={e=>config('template',e.target.value)}/><span className="text-xs text-gray-500">{'仅支持 {technician_code} 技师编号、{room_no} 房间号。'}</span></label>
   <div className="sm:col-span-2 space-y-2"><p>预期触发方式（保存草稿，不启用自动播报）</p>{[['manual_call','手动叫钟'],['assigned','派钟成功'],['reassigned','更换技师']].map(([v,t])=><label key={v} className="inline-flex items-center gap-2 mr-4"><input type="checkbox" checked={form.announcer_config.triggers.includes(v)} onChange={e=>config('triggers',e.target.checked?[...form.announcer_config.triggers,v]:form.announcer_config.triggers.filter((x:string)=>x!==v))}/>{t}</label>)}</div>
  </fieldset><p className="text-xs text-gray-500">每店一份播报器/网关配置；多终端分区和认证方式待厂商协议确认。请勿在任何字段填写密码、令牌或密钥。</p>
  <div className="flex gap-3"><button className="btn-primary" disabled={busy||!writable} onClick={()=>void save()}>{unknown?'核对原保存结果':'保存播报器配置'}</button>{!unknown&&<button className="btn-secondary" disabled={busy} onClick={()=>setForm(null)}>取消</button>}</div></>}
  {loaded&&<div className="rounded border p-3 space-y-2" aria-label="播报器接入诊断"><p className="font-medium">配置：{readiness.configured?'已保存':'未配置'} · 设备连接：未验证 · 播报送达：未验证</p>{readiness.missing.length>0?<ul className="list-disc pl-5 text-sm">{readiness.missing.map(item=><li key={item}>{item}</li>)}</ul>:<p className="text-sm">准备信息已齐全，仍需完成厂商适配和实机播报验证。</p>}<p className="text-sm text-gray-500">地址和端口仅作配置检查，本次不会向设备发送指令。派钟自动播报尚未启用。</p></div>}
  <AsyncButton className="btn-secondary" disabled={busy||unknown} onClick={async()=>{setError('');await load();setNotice('已重新读取保存的配置；未执行设备连接或播报测试。')}}>刷新配置诊断</AsyncButton>
  {error&&<p role="alert" className="text-red-700">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>
}
