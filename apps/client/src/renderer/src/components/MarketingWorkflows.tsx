import {useCallback,useEffect,useRef,useState} from 'react'
import {MarketingWorkflow} from '@za-spa/contracts'
import {remote,isRemoteFailure} from '../api/transport'
import {useAutoRefresh} from '../hooks/useAutoRefresh'
import {useAuth,canWriteBusiness} from '../store/auth'
import {Modal,EmptyState} from './ui'
import {fmtDateTime,fmtMoney} from '../utils/format'

const prefix='/api/merchant/v1/marketing'
const explanations:Record<string,string>={new_member_no_visit:'入会达到设定天数且从未消费，每位会员触发一次。',after_visit:'启用后每笔已结账订单，经过设定天数触发。',birthday:'生日当天进入队列，每年一次。',dormant:'达到沉睡天数未消费，每个沉睡周期一次。',member_expiry:'到期前七天内进入队列，每个到期日一次。',booking_cancel:'启用后取消预约，按同店手机号匹配会员。'}
const statuses:Record<string,string>={pending:'待处理',issued:'已发券',skipped:'已跳过',failed:'失败'}
type Request={path:string;method:string;body:unknown;key:string}
export default function MarketingWorkflows(){
 const epoch=useAuth(s=>s.epoch),realm=useAuth(s=>s.realm),merchant=useAuth(s=>s.merchant)
 const [workflows,setWorkflows]=useState<any[]>([]),[outbox,setOutbox]=useState<any[]>([]),[before,setBefore]=useState<number>(),[pages,setPages]=useState<Array<number|undefined>>([])
 const [form,setForm]=useState<any>(null),[retry,setRetry]=useState<number|null>(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false)
 const running=useRef(false),pending=useRef<Request|null>(null),sequence=useRef(0),mounted=useRef(true)
 const writable=canWriteBusiness()
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++}},[])
 const load=useCallback(async()=>{const seq=++sequence.current;try{const [w,o]=await Promise.all([remote<any[]>(prefix+'/workflows'),remote<any[]>(prefix+'/outbox'+(before?'?before='+before:''))]);if(mounted.current&&seq===sequence.current){setWorkflows(w);setOutbox(o)}}catch(e){if(mounted.current&&seq===sequence.current)setError(e instanceof Error?e.message:'加载失败')}},[before,epoch])
 useAutoRefresh(load)
 async function submit(request:Request){
  if(running.current)return;running.current=true;pending.current=request;setBusy(true);setError('')
  try{const result=await remote<any>(prefix+request.path,{method:request.method,body:JSON.stringify(request.body),headers:{'Idempotency-Key':request.key}});if(!mounted.current)return
   if(isRemoteFailure(result)){setUnknown(result.code==='RESULT_UNKNOWN');if(result.code!=='RESULT_UNKNOWN')pending.current=null;setError(result.msg);return}
   pending.current=null;setUnknown(false);setForm(null);setRetry(null)
   if(request.path.startsWith('/workflows/')){sequence.current++;setWorkflows(old=>old.map(w=>w.trigger_type===result.trigger_type?result:w));setNotice('工作流已保存')}
   else {setNotice(request.path==='/run'?`扫描完成：新增 ${result.scheduled} 项，发券 ${result.issued} 张，失败 ${result.failed} 项`:'任务已重新排队');await load()}
  }catch(e){if(mounted.current){setUnknown(true);setError(e instanceof Error?e.message:'结果尚未确认')}}finally{running.current=false;if(mounted.current)setBusy(false)}
 }
 function start(path:string,method:string,body:unknown){if(!unknown)void submit({path,method,body,key:crypto.randomUUID()})}
 function save(){const parsed=MarketingWorkflow.safeParse(Object.fromEntries(Object.keys(MarketingWorkflow.shape).map(key=>[key,form[key]])));if(!parsed.success){setError('请检查名称、金额和天数：券金额须大于零，门槛不能为负，券有效期为 1–365 天。');return}start('/workflows/'+form.trigger_type,'PUT',parsed.data)}
 const blocked=busy||unknown
 return <div className="space-y-4 max-w-5xl">
  <div className="card p-5 flex justify-between gap-4"><div><h3 className="font-semibold">自动营销工作流</h3><p className="text-sm text-gray-500 mt-1">按门店规则发放系统优惠券。短信、微信接口已预留，尚未接入。</p></div><button className="btn-primary" disabled={!writable||blocked} onClick={()=>start('/run','POST',{})}>{busy?'处理中…':'立即扫描'}</button></div>
  {error&&<div role="alert" className="text-red-600">{error}</div>}{notice&&<div role="status">{notice}</div>}
  {unknown&&<div className="card p-4">上次结果尚未确认，已锁定操作以防重复。<button className="btn-secondary ml-3" disabled={busy} onClick={()=>pending.current&&void submit(pending.current)}>原请求重试</button></div>}
  <div className="card overflow-x-auto"><table className="table w-full"><thead><tr><th>工作流</th><th>状态</th><th>优惠券</th><th>操作</th></tr></thead><tbody>{workflows.map(w=><tr key={w.trigger_type}><td><div className="font-medium">{w.name}</div><div className="text-xs text-gray-500 max-w-sm">{explanations[w.trigger_type]}</div></td><td>{w.enabled?'启用中':w.id?'已停用':'未启用'}</td><td>{w.coupon_name}<div className="text-xs text-gray-500">满 {fmtMoney(w.coupon_min_amount)} 减 {fmtMoney(w.coupon_value)} · {w.coupon_expire_days} 天有效</div></td><td><button className="btn-secondary" disabled={!writable||blocked} onClick={()=>{setError('');setForm({...w,enabled:Boolean(w.enabled)})}}>配置</button></td></tr>)}</tbody></table></div>
  <div className="card p-5 overflow-x-auto"><h3 className="font-semibold mb-3">营销记录</h3><table className="table w-full"><thead><tr><th>工作流 / 会员</th><th>处理状态</th><th>时间</th><th>操作</th></tr></thead><tbody>{outbox.map(o=><tr key={o.id}><td>{o.workflow_name}<div>{o.member_name||o.customer_phone}</div></td><td>{statuses[o.status]??o.status}{o.coupon_id&&` · 券 #${o.coupon_id}`}<div className="text-xs text-gray-500">尝试 {o.attempts} 次 {o.last_error_code}{o.next_retry_at&&` · 下次 ${fmtDateTime(o.next_retry_at)}`}</div></td><td>{fmtDateTime(o.processed_at||o.scheduled_at)}</td><td>{o.status==='failed'&&!o.coupon_id&&<button className="btn-secondary" disabled={!writable||blocked||o.channel!=='in_app'} onClick={()=>{setRetry(o.id);setReason('');setError('')}}>重新排队</button>}</td></tr>)}</tbody></table>{outbox.length===0&&<EmptyState text="暂无营销记录" />}<div className="flex gap-3 mt-3"><button className="btn-secondary" disabled={!pages.length||blocked} onClick={()=>{setBefore(pages[pages.length-1]);setPages(p=>p.slice(0,-1))}}>上一页</button><button className="btn-secondary" disabled={outbox.length<100||blocked} onClick={()=>{setPages(p=>[...p,before]);setBefore(outbox[outbox.length-1].id)}}>下一页</button></div></div>
  <Modal open={!!form} title="配置自动营销" onClose={()=>{if(!blocked)setForm(null)}} footer={unknown?<button className="btn-primary" disabled={busy} onClick={()=>pending.current&&void submit(pending.current)}>原请求重试</button>:<button className="btn-primary" disabled={busy} onClick={save}>保存工作流</button>}>
   {form&&<fieldset disabled={blocked} className="space-y-3"><p className="text-sm text-gray-500">{explanations[form.trigger_type]}</p><label className="flex gap-2"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>启用工作流</label>{[['name','工作流名称'],['coupon_name','券名称']].map(([key,label])=><label className="block" key={key}>{label}<input className="input w-full" value={form[key]} maxLength={100} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}<div className="grid grid-cols-2 gap-3">{[['delay_days','延迟天数'],['dormant_days','沉睡天数'],['coupon_value','券金额'],['coupon_min_amount','最低消费'],['coupon_expire_days','券有效天数']].map(([key,label])=><label key={key}>{label}<input className="input w-full" type="number" step={key==='coupon_value'||key==='coupon_min_amount'?'.01':'1'} value={form[key]} onChange={e=>setForm({...form,[key]:Number(e.target.value)})}/></label>)}</div><label className="block">发放渠道<select className="input w-full" value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}><option value="in_app">系统券包</option><option value="sms" disabled>短信（未接入）</option><option value="wechat" disabled>微信（未接入）</option></select></label>{error&&<p role="alert" className="text-red-600">{error}</p>}</fieldset>}
  </Modal>
  <Modal open={retry!==null} title="营销任务重新排队" onClose={()=>{if(!blocked)setRetry(null)}} footer={unknown?<button className="btn-primary" disabled={busy} onClick={()=>pending.current&&void submit(pending.current)}>原请求重试</button>:<button className="btn-primary" disabled={busy||!reason.trim()} onClick={()=>start('/outbox/'+retry+'/retry','POST',{reason:reason.trim()})}>确认重新排队</button>}><label>修复情况与重试原因<textarea className="input w-full" disabled={blocked} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert" className="text-red-600">{error}</p>}</Modal>
 </div>
}
