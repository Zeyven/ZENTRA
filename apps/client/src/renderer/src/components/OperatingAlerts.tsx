import {useCallback,useState} from 'react'
import {api} from '../api'
import {useAutoRefresh} from '../hooks/useAutoRefresh'

type Destination='orders'|'settings'|'shift'|'items'
export default function OperatingAlerts({onNav}:{onNav?:(page:Destination)=>void}){
 const [data,setData]=useState<any[]|null>(null),[error,setError]=useState('')
 const load=useCallback(async()=>{try{const result=await api.alerts();setData(result.list);setError('')}catch{setError('经营提醒读取失败，当前待办未确认')}},[])
 useAutoRefresh(load,30000,{pollWhenConnected:true})
 const destination:Record<string,Destination>={low_stock:'items',long_order:'orders',frequent_reversals:'orders',gateway_attention:'settings',cash_difference:'shift'}
 return <details className="mx-5 my-2 rounded border px-3 py-2" aria-label="经营异常提醒"><summary className="cursor-pointer text-sm">经营异常与核对提醒 · {error?'读取失败':data===null?'读取中':`${data.length} 项`}</summary>
 {error&&<p role="alert" className="text-red-700">{error}</p>}{!error&&data?.length===0&&<p className="text-sm py-2">当前授权范围内没有经营异常提醒</p>}
 <div className="max-h-48 overflow-auto">{data?.map((row,index)=><div key={row.type+String(row.target_id??index)} className="border-t py-2 text-sm"><strong>{row.title}</strong><p>{row.detail}</p>{destination[row.type]&&onNav&&<button className="btn-secondary mt-1" onClick={()=>onNav(destination[row.type])}>前往核对</button>}</div>)}</div>
 </details>
}
