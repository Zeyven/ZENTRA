import {useCallback,useEffect,useRef,useState} from 'react'
import {MemberAdjustment,type MemberAssetAccount,type MemberAssetOperation,type MemberAssetPage} from '@za-spa/contracts'
import {remote,isRemoteFailure} from '../api/transport'
import {useAuth,canWriteBusiness} from '../store/auth'
import {useAutoRefresh} from '../hooks/useAutoRefresh'
import {can} from '../utils/permissions'
import {fmtMoney,fmtDateTime} from '../utils/format'
import {AsyncButton,Modal,EmptyState} from './ui'

const prefix='/api/merchant/v1/members/'
const names:Record<string,string>={recharge:'充值',consume:'消费',reverse:'冲回',adjust:'权益调整',points:'积分兑换',earn:'消费赠积分'}
type Adjustment={account:MemberAssetAccount;principal:number;bonus:number;times:number;points:number;reason:string}
type RequestRecord={path:string;body:unknown;key:string}
const fields=['principal','bonus','times','points'] as const
const labels={principal:'本金',bonus:'赠金',times:'次数',points:'积分'}
const current=(a:MemberAssetAccount,key:typeof fields[number])=>({principal:a.balance,bonus:a.bonus_balance,times:a.times_balance,points:a.points})[key]

export default function MemberAssets({memberId,initial,onMember}:{memberId:number;initial:MemberAssetPage;onMember:(member:MemberAssetAccount)=>void}){
 const {user,merchant,realm,currentStoreId,stores}=useAuth()
 const writable=canWriteBusiness(true)
 const [data,setData]=useState<MemberAssetPage|null>(initial),[error,setError]=useState(''),[notice,setNotice]=useState(''),[before,setBefore]=useState<number>(),[history,setHistory]=useState<Array<number|undefined>>([])
 const [adjustment,setAdjustment]=useState<Adjustment|null>(null),[refund,setRefund]=useState<MemberAssetOperation|null>(null),[reason,setReason]=useState(''),[allocations,setAllocations]=useState<any[]|null>(null)
 const [busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[formError,setFormError]=useState('')
 const running=useRef(false),pending=useRef<RequestRecord|null>(null),sequence=useRef(0),mounted=useRef(true),notify=useRef(onMember),initialLoad=useRef(true)
 notify.current=onMember
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++}},[])
 const load=useCallback(async()=>{
  if(initialLoad.current){initialLoad.current=false;return}
  const id=++sequence.current
  try{const result=await remote<MemberAssetPage>(prefix+memberId+'/assets'+(before?'?before='+before:''));if(!mounted.current||id!==sequence.current)return;setData(result);notify.current(result.member);setError('')}
  catch(e){if(mounted.current&&id===sequence.current)setError(e instanceof Error?e.message:'权益流水加载失败')}
 },[memberId,before])
 useAutoRefresh(load)
 async function submit(request:RequestRecord){
  if(running.current)return;running.current=true;setBusy(true);setFormError('');pending.current=request
  try{
   const result=await remote<any>(prefix+memberId+request.path,{method:'POST',body:JSON.stringify(request.body),headers:{'Idempotency-Key':request.key}})
   if(!mounted.current)return
   if(isRemoteFailure(result)){
    if(result.pending_approval){pending.current=null;setUnknown(false);setAdjustment(null);setRefund(null);setNotice(`已提交审批 #${result.approval_id}，资产尚未改变。另一位管理员批准后，由原申请人在审批中心执行。`);return}
    const uncertain=result.code==='RESULT_UNKNOWN';setUnknown(uncertain);if(!uncertain)pending.current=null;setFormError(result.msg);return
   }
   sequence.current++;notify.current(result.member)
   const operation={...result.operation,store_name:stores.find(s=>s.id===currentStoreId)?.name??'',reversed_by:null}
   setData(previous=>{
    if(!previous||previous.member.asset_version>result.member.asset_version)return previous
    if(before)return {...previous,member:result.member}
    const items=[operation,...previous.items.filter(i=>i.id!==operation.id).map(i=>i.id===operation.reversal_of?{...i,reversed_by:operation.id}:i)]
    return {...previous,member:result.member,items:items.slice(0,50),next_cursor:items.length>50?items[49].id:previous.next_cursor}
   })
   pending.current=null;setUnknown(false);setAdjustment(null);setRefund(null);setNotice(request.path==='/adjust'?'权益调整已落账':'充值退款已登记，原权益已冲回')
  }catch(e){if(mounted.current){setUnknown(true);setFormError(e instanceof Error?e.message:'结果尚未确认，请沿用原请求重试')}}
  finally{running.current=false;if(mounted.current)setBusy(false)}
 }
 const start=(path:string,body:unknown)=>{if(!unknown&&!running.current)return submit({path,body,key:crypto.randomUUID()})}
 const close=()=>{if(running.current||unknown)return;setAdjustment(null);setRefund(null);setFormError('')}
 function saveAdjustment(){
  if(!adjustment)return
  const {account,...body}=adjustment,result=MemberAdjustment.safeParse({...body,version:account.asset_version})
  if(!result.success){setFormError(result.error.issues[0].message);return}
  if(fields.some(k=>current(account,k)+result.data[k]<0)){setFormError('调整后权益不能为负数');return}
  return start('/adjust',result.data)
 }
 const warning=<>{formError&&<p role="alert" className="p-3 mb-3 bg-red-50 text-red-700 text-sm rounded-lg">{formError}</p>}{unknown&&<div className="p-3 mb-3 bg-amber-50 text-amber-800 text-sm rounded-lg"><p>结果尚未确认，已保留原请求和表单。请勿重复办理同笔业务。</p><AsyncButton className="btn-secondary mt-2" disabled={busy} onClick={()=>pending.current&&submit(pending.current)}>核对原请求结果</AsyncButton></div>}</>
 return (<section className="my-5 space-y-3" aria-label="会员权益管理">
  <div className="flex items-center justify-between gap-2 flex-wrap"><h3 className="font-semibold">权益与资金流水</h3><div className="flex gap-2"><AsyncButton className="btn-secondary text-xs" disabled={busy||unknown} onClick={load}>刷新权益</AsyncButton>{writable&&can(user,'adjust')&&<button className="btn-primary text-xs" disabled={!data||busy||unknown} onClick={()=>{setFormError('');setAdjustment({account:data!.member,principal:0,bonus:0,times:0,points:0,reason:''})}}>调整权益</button>}</div></div>
  {error&&<p role="alert" className="text-red-700 text-sm">{error}</p>}{notice&&<p role="status" className="p-3 bg-emerald-50 text-emerald-800 text-sm rounded-lg">{notice}</p>}
  <p className="text-xs text-gray-500">{user?.role==='owner'?'展示会员在本商家的权益流水。':'展示当前门店的权益流水；通用会员余额为全商家可用权益。'}本金、赠金分别记账，冲回保留原流水。</p>
  <div className="overflow-auto max-h-80"><table className="table w-full"><thead><tr><th>时间 / 门店</th><th>业务</th><th>本金</th><th>赠金</th><th>次数</th><th>积分</th><th>原因 / 操作</th></tr></thead><tbody>{data?.items.map(row=><tr key={row.id} data-testid={'member-asset-'+row.id}><td className="text-xs whitespace-nowrap">{fmtDateTime(row.created_at)}<div>{row.store_name}</div></td><td className="whitespace-nowrap">{names[row.type]??row.type}{row.reversed_by&&<div className="text-xs text-gray-500">已冲回</div>}</td><td>{fmtMoney(row.principal)}</td><td>{fmtMoney(row.bonus)}</td><td>{row.times}</td><td>{row.points}</td><td className="min-w-40"><div>{row.reason}</div>{row.type==='recharge'&&<div className="text-xs text-gray-500">实收 {fmtMoney(row.funded_amount)} · {row.payment_method}</div>}<AsyncButton className="text-xs text-brand-600 mr-2" onClick={async()=>{const result=await remote<any>(prefix+memberId+'/assets/'+row.id);if(mounted.current)setAllocations(result.allocations)}}>批次分配</AsyncButton>{writable&&can(user,'reverseSettle')&&row.type==='recharge'&&!row.reversed_by&&<button className="text-xs text-red-600" disabled={busy||unknown} onClick={()=>{setRefund(row);setReason('');setFormError('')}}>登记充值退款</button>}</td></tr>)}</tbody></table>{!data?.items.length&&<EmptyState text={data?'暂无权益流水':'正在读取权益流水…'}/>}</div>
  <div className="flex justify-end gap-2"><button className="btn-secondary text-xs" disabled={!history.length||busy||unknown} onClick={()=>{setBefore(history.at(-1));setHistory(history.slice(0,-1))}}>上一页流水</button><button className="btn-secondary text-xs" disabled={!data?.next_cursor||busy||unknown} onClick={()=>{setHistory([...history,before]);setBefore(data!.next_cursor!)}}>下一页流水</button></div>
  <Modal open={!!adjustment} title="调整会员权益" onClose={close} width="max-w-2xl" footer={<><button className="btn-secondary" disabled={busy||unknown} onClick={close}>取消</button><AsyncButton className="btn-primary" disabled={busy||unknown} onClick={saveAdjustment}>确认权益调整</AsyncButton></>}>
   {warning}{adjustment&&<fieldset disabled={busy||unknown} className="space-y-4"><p className="text-sm text-gray-500">正数增加，负数扣减。此操作调整会员权益，不登记实际收付款。</p><div className="grid grid-cols-2 gap-4">{fields.map(key=><label key={key}><span className="label">{labels[key]}调整</span><input aria-label={labels[key]+'调整'} className="input" type="number" step={key==='times'||key==='points'?'1':'0.01'} value={Number.isFinite(adjustment[key])?adjustment[key]:''} onChange={e=>setAdjustment({...adjustment,[key]:e.target.valueAsNumber})}/><span className="text-xs text-gray-500">当前 {current(adjustment.account,key)} → 调整后 {Number.isFinite(adjustment[key])?Number((current(adjustment.account,key)+adjustment[key]).toFixed(2)):'—'}</span></label>)}</div><label className="block"><span className="label">调整原因（必填）</span><input aria-label="权益调整原因" className="input" value={adjustment.reason} maxLength={500} onChange={e=>setAdjustment({...adjustment,reason:e.target.value})}/></label><AsyncButton className="btn-secondary" onClick={async()=>{const result=await remote<MemberAssetPage>(prefix+memberId+'/assets');if(mounted.current){setAdjustment({...adjustment,account:result.member});setFormError('');notify.current(result.member)}}}>重新读取当前权益</AsyncButton></fieldset>}
  </Modal>
  <Modal open={!!refund} title="登记充值退款" onClose={close} footer={<><button className="btn-secondary" disabled={busy||unknown} onClick={close}>取消</button><AsyncButton className="btn-primary" disabled={busy||unknown} onClick={()=>{if(!reason.trim()){setFormError('请填写退款原因');return}if(refund)return start('/reverse-recharge',{recharge_id:refund.id,reason:reason.trim()})}}>确认退款登记</AsyncButton></>}>
   {warning}{refund&&<fieldset disabled={busy||unknown} className="space-y-4"><div className="p-4 rounded-xl bg-gray-50"><p className="text-sm">原充值 · {refund.store_name}</p><p className="text-3xl font-semibold text-brand-700 my-2">{fmtMoney(refund.funded_amount)}</p><p className="text-sm">原收款方式：{refund.payment_method}</p></div><p className="text-sm text-gray-600">此处登记线下退款，不自动调用支付渠道。原充值的本金、赠金、次数和积分必须全部可冲回；已使用的权益不能用其他充值余额替代。</p><label className="block"><span className="label">退款原因（必填）</span><input aria-label="充值退款原因" className="input" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label></fieldset>}
  </Modal>
  <Modal open={allocations!==null} title="权益批次分配" onClose={()=>setAllocations(null)} width="max-w-2xl"><table className="table w-full"><thead><tr><th>来源门店 / 批次</th><th>本金</th><th>赠金</th><th>次数</th><th>积分</th></tr></thead><tbody>{allocations?.map(row=><tr key={row.lot_id}><td>{row.origin_store_name} / #{row.lot_id}</td><td>{fmtMoney(row.principal)}</td><td>{fmtMoney(row.bonus)}</td><td>{row.times}</td><td>{row.points}</td></tr>)}</tbody></table>{!allocations?.length&&<EmptyState text="此流水没有权益批次分配"/>}</Modal>
 </section>
 )
}
