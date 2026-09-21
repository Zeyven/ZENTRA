import {useRef,useState} from 'react'
import {api} from '../api'
import {AsyncButton,Modal} from './ui'
export default function MemberWake():JSX.Element {
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[message,setMessage]=useState('')
 const [form,setForm]=useState({name:'老友回归唤醒券',value:50,min_amount:100,expire_days:30,threshold_days:90})
 const key=useRef<string|null>(null)
 async function submit(){
  key.current??=crypto.randomUUID();setBusy(true);setMessage('')
  try{const result=await api.wakeSleepMembers(form,key.current)
   if(result.ok===false){setUnknown(result.code==='RESULT_UNKNOWN');if(result.code!=='RESULT_UNKNOWN')key.current=null;setMessage(result.msg||'发券失败');return}
   key.current=null;setUnknown(false);setMessage(`已发放 ${result.count} 张优惠券；已有同名有效券的会员自动跳过。`)
  }catch(e){setUnknown(true);setMessage(e instanceof Error?e.message:'结果未确认，请核对原请求')}
  finally{setBusy(false)}
 }
 return <><button className="btn-primary" onClick={()=>setOpen(true)}>唤醒会员发券</button><Modal open={open} title="唤醒会员发券" onClose={()=>{if(!busy&&!unknown)setOpen(false)}} footer={<AsyncButton className="btn-primary" onClick={submit}>{unknown?'核对原请求':'确认批量发券'}</AsyncButton>}>
 <p className="text-sm text-gray-500 mb-4">向从未消费或指定天数未消费的有效会员发放本店优惠券。通用会员按本商家全部门店消费判断；不会发送短信。</p>
 <label className="block mb-3">优惠券名称<input className="input" disabled={busy||unknown} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
 {([['value','券面额（元）'],['min_amount','最低消费（元）'],['expire_days','有效天数'],['threshold_days','未消费天数']] as const).map(([field,label])=><label key={field} className="block mb-3">{label}<input className="input" type="number" disabled={busy||unknown} value={form[field]} onChange={e=>setForm({...form,[field]:Number(e.target.value)})}/></label>)}
 {message&&<p role="status" className="text-sm mt-3">{message}</p>}
 </Modal></>
}
