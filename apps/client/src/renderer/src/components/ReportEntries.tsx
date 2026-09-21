import {useEffect,useRef,useState} from 'react'
import {remote} from '../api/transport'
import {AsyncButton} from './ui'
import {fmtMoney,fmtDateTime} from '../utils/format'

const labels:Record<string,string>={sale:'营业销售',sale_reversal:'销售冲销',discount:'优惠',discount_reversal:'优惠冲回',payment:'收款',payment_reversal:'收款冲回',recharge:'充值',recharge_reversal:'充值冲销',deposit:'押金收取',deposit_refund:'押金退还',booking_deposit:'预约定金',booking_refund:'定金退还'}
export default function ReportEntries({start,end}:{start:string;end:string}){
 const [rows,setRows]=useState<any[]>([]),[next,setNext]=useState<number|null>(null),[error,setError]=useState(''),[loaded,setLoaded]=useState(false)
 const live=useRef(false),lock=useRef(false)
 async function load(before?:number){
  if(lock.current)return;lock.current=true;setError('')
  try{const query=new URLSearchParams({start_date:start,end_date:end,...(before?{before:String(before)}:{})});const result=await remote<any>('/api/merchant/v1/reports/entries?'+query);if(live.current){setRows(old=>before?[...old,...result.rows]:result.rows);setNext(result.next);setLoaded(true)}}
  catch(e){if(live.current)setError(e instanceof Error?e.message:'流水读取失败')}
  finally{lock.current=false}
 }
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false}},[])
 return <section aria-label="报表原始流水" className="space-y-3"><p>{start} 至 {end} · 北京时间 · 按实际记账日期</p><p className="text-sm text-gray-500">销售、优惠、收款、充值及押金分别记账，不应将全部行直接相加作为营业额。冲回记录保留原流水编号；班次与订单编号可用于对账。</p>
 {error&&<p role="alert" className="text-red-700">{error}<AsyncButton className="btn-secondary ml-2" onClick={()=>load(loaded?next??undefined:undefined)}>重新读取</AsyncButton></p>}
 {!loaded&&!error&&<p role="status">正在读取流水…</p>}
 <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['流水','时间','类型','金额','方式','订单','班次','操作员','冲回原流水','原因'].map(x=><th key={x} className="text-left p-2 whitespace-nowrap">{x}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-b">{[row.id,fmtDateTime(row.created_at),labels[row.kind]??row.kind,fmtMoney(row.amount),row.method??'—',row.order_no??'—',row.shift_id??'—',row.operator_name??'—',row.reversal_of??'—',row.reason].map((v,i)=><td key={i} className="p-2 whitespace-nowrap">{v}</td>)}</tr>)}</tbody></table></div>
 {loaded&&!rows.length&&<p>该日期范围没有记账流水</p>}{next&&<AsyncButton className="btn-secondary" onClick={()=>load(next)}>加载更早流水</AsyncButton>}
 </section>
}
