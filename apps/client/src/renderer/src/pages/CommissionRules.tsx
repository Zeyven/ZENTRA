import {useCallback,useRef,useState} from 'react'
import {remote,isRemoteFailure} from '../api/transport'
import {api} from '../api'
import {useAutoRefresh} from '../hooks/useAutoRefresh'
import {AsyncButton,EmptyState} from '../components/ui'
import {toast} from '../store/toast'
import {fmtMoney,parseMoneyInput} from '../utils/format'
const empty={id:undefined as number|undefined,version:undefined as number|undefined,name:'',priority:100,action_type:'rate',action_value:'',stack_mode:'first',effective_from:'',effective_to:'',active:1,technician_ids:[] as number[],item_ids:[] as number[],technician_levels:'',service_types:[] as string[],min_amount:'',max_amount:'',min_count:''}
export default function CommissionRules(){
 const [form,setForm]=useState({...empty}),[rules,setRules]=useState<any[]>([]),[technicians,setTechnicians]=useState<any[]>([]),[items,setItems]=useState<any[]>([]),[error,setError]=useState('');const sequence=useRef(0)
 const load=useCallback(async()=>{const id=++sequence.current;try{const [r,t,i]=await Promise.all([remote<any[]>('/api/merchant/v1/commission-rules'),api.listTechnicians(),api.listItems()]);if(sequence.current!==id)return;setRules(r);setTechnicians(t);setItems(i.filter(row=>row.type==='service'));setError('')}catch(e){if(sequence.current===id)setError(e instanceof Error?e.message:'提成规则加载失败')}},[])
 useAutoRefresh(load)
 const change=(key:keyof typeof form,value:any)=>setForm(prev=>({...prev,[key]:value}))
 const save=async()=>{
  const actionValue=parseMoneyInput(form.action_value)
  if(form.action_type==='rate'){if(!Number.isFinite(actionValue)||actionValue<=0||actionValue>100){toast('提成比例必须大于 0','error');return}}
  else if(!Number.isFinite(actionValue)||actionValue<=0){toast('提成金额必须大于 0','error');return}
  const {technician_ids,item_ids,technician_levels,service_types,min_amount,max_amount,min_count,...base}=form
  const conditions={...(technician_ids.length?{technician_ids}:{}),...(item_ids.length?{item_ids}:{}),...(technician_levels.trim()?{technician_levels:technician_levels.split(/[，,]/).map(s=>s.trim()).filter(Boolean)}:{}),...(service_types.length?{service_types}:{}),...(min_amount!==''?{min_amount:Number(min_amount)}:{}),...(max_amount!==''?{max_amount:Number(max_amount)}:{}),...(min_count!==''?{min_count:Number(min_count)}:{})}
  const result=await remote('/api/merchant/v1/commission-rules',{method:'POST',body:JSON.stringify({...base,action_value:actionValue,conditions})});if(isRemoteFailure(result))throw Error(result.msg)
  setForm({...empty});toast('提成规则已保存');await load()
 }
 return <section className="space-y-4 mt-5" aria-label="复合提成规则">
  {error&&<div role="alert" className="text-red-600">{error}<AsyncButton className="btn-secondary ml-2" onClick={load}>重新加载</AsyncButton></div>}
  <div className="card p-5"><h3 className="font-semibold mb-2">复合提成规则</h3><p className="text-sm text-gray-500 mb-4">按优先级匹配服务、技师与期间业绩，可按金额比例、每钟固定额或每项奖励计算。已锁定月工资保留原结果。</p>
   <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
    <label>提成规则名称<input className="input" value={form.name} onChange={e=>change('name',e.target.value)}/></label>
    <label>提成方式<select className="input" value={form.action_type} onChange={e=>change('action_type',e.target.value)}><option value="rate">服务金额百分比</option><option value="fixed">每钟固定金额</option><option value="bonus">每项额外奖励</option></select></label>
    <label>{form.action_type==='rate'?'提成比例（%）':'提成金额（元）'}<input className="input" type="number" min="0" step="0.01" value={form.action_value} onChange={e=>change('action_value',e.target.value)}/></label>
    <label>匹配优先级<input className="input" type="number" min="0" value={form.priority} onChange={e=>change('priority',Number(e.target.value))}/></label>
    <label>适用技师（可多选，未选不限）<select className="input" multiple value={form.technician_ids.map(String)} onChange={e=>change('technician_ids',Array.from(e.target.selectedOptions,o=>Number(o.value)))}>{technicians.map(t=><option key={t.id} value={t.id}>{t.code} {t.name}</option>)}</select></label>
    <label>适用服务（可多选，未选不限）<select className="input" multiple value={form.item_ids.map(String)} onChange={e=>change('item_ids',Array.from(e.target.selectedOptions,o=>Number(o.value)))}>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
    <label>技师等级<input className="input" placeholder="多个等级用逗号分隔；留空不限" value={form.technician_levels} onChange={e=>change('technician_levels',e.target.value)}/></label>
    <label>钟类型（可多选，未选不限）<select className="input" multiple value={form.service_types} onChange={e=>change('service_types',Array.from(e.target.selectedOptions,o=>o.value))}>{['轮钟','点钟','加钟','半钟','排钟'].map(t=><option key={t}>{t}</option>)}</select></label>
    <label>期间业绩下限<input className="input" type="number" min="0" step="0.01" value={form.min_amount} onChange={e=>change('min_amount',e.target.value)}/></label>
    <label>期间业绩上限<input className="input" type="number" min="0" step="0.01" value={form.max_amount} onChange={e=>change('max_amount',e.target.value)}/></label>
    <label>期间钟数下限<input className="input" type="number" min="0" value={form.min_count} onChange={e=>change('min_count',e.target.value)}/></label>
    <label>规则叠加<select className="input" value={form.stack_mode} onChange={e=>change('stack_mode',e.target.value)}><option value="first">首条命中时使用</option><option value="stack">与先前命中规则叠加</option></select></label>
    <label>提成生效日期<input className="input" type="date" value={form.effective_from} onChange={e=>change('effective_from',e.target.value)}/></label>
    <label>提成结束日期<input className="input" type="date" value={form.effective_to} onChange={e=>change('effective_to',e.target.value)}/></label>
   </div>
   <div className="flex gap-3 items-center mt-4"><AsyncButton className="btn-primary" onClick={save}>{form.id?'保存提成修改':'新增提成规则'}</AsyncButton>{form.id&&<button className="btn-secondary" onClick={()=>setForm({...empty})}>取消提成编辑</button>}</div>
  </div>
  <div className="card overflow-auto"><table className="table w-full"><thead><tr><th>名称</th><th>计算</th><th>适用条件</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead><tbody>{rules.map(rule=><tr key={rule.id}><td>{rule.name}</td><td>{rule.action_type==='rate'?`${rule.action_value}%`:`${fmtMoney(rule.action_value)} / ${rule.action_type==='fixed'?'钟':'项'}`}</td><td>{[...(rule.conditions.technician_ids||[]).map((id:number)=>technicians.find(t=>t.id===id)?.name||'已停用技师'),...(rule.conditions.item_ids||[]).map((id:number)=>items.find(i=>i.id===id)?.name||'已停用服务'),...(rule.conditions.technician_levels||[]),...(rule.conditions.service_types||[])].join('、')||'全部服务'}{rule.conditions.min_amount!==undefined&&`，业绩 ≥ ${fmtMoney(rule.conditions.min_amount)}`}{rule.conditions.max_amount!==undefined&&`，业绩 ≤ ${fmtMoney(rule.conditions.max_amount)}`}{rule.conditions.min_count!==undefined&&`，钟数 ≥ ${rule.conditions.min_count}`}</td><td>{rule.priority}</td><td>{rule.active?'启用':'停用'}</td><td><button className="text-brand-600 mr-3" onClick={()=>{
    const c=rule.conditions
    setForm({...empty,id:rule.id,version:rule.version,name:rule.name,priority:rule.priority,action_type:rule.action_type,action_value:String(rule.action_value ?? ''),stack_mode:rule.stack_mode,effective_from:rule.effective_from||'',effective_to:rule.effective_to||'',active:rule.active,technician_ids:c.technician_ids||[],item_ids:c.item_ids||[],technician_levels:(c.technician_levels||[]).join('，'),service_types:c.service_types||[],min_amount:c.min_amount===undefined?'':String(c.min_amount),max_amount:c.max_amount===undefined?'':String(c.max_amount),min_count:c.min_count===undefined?'':String(c.min_count)})
   }}>编辑</button>{rule.active?<AsyncButton className="text-red-600" onClick={async()=>{const result=await remote('/api/merchant/v1/commission-rules/'+rule.id,{method:'DELETE',body:JSON.stringify({version:rule.version,reason:'经营配置停用'})});if(isRemoteFailure(result))throw Error(result.msg);await load();toast('提成规则已停用')}}>停用</AsyncButton>:<AsyncButton className="text-brand-600" onClick={async()=>{const {merchant_id,store_id,created_at,updated_at,created_by,ok,...body}=rule;const result=await remote('/api/merchant/v1/commission-rules',{method:'POST',body:JSON.stringify({...body,active:1})});if(isRemoteFailure(result))throw Error(result.msg);await load()}}>启用</AsyncButton>}</td></tr>)}</tbody></table>{!rules.length&&!error&&<EmptyState text="暂无复合提成规则；按技师提成率和阶梯配置计算"/>}</div>
 </section>
}
