import {useAuth} from '../store/auth'
import {getServerUrl} from './transport'

export async function exportBusiness(){
 const session=useAuth.getState(),controller=new AbortController()
 const unsubscribe=useAuth.subscribe(state=>{if(state.epoch!==session.epoch)controller.abort()})
 try{
  const response=await fetch(getServerUrl()+'/api/merchant/v1/exports/business',{headers:{Authorization:'Bearer '+session.token},signal:controller.signal,credentials:'omit'})
  if(!response.ok){const failure=await response.json();throw Error(failure.message||'导出失败')}
  const text=await response.text();if(useAuth.getState().epoch!==session.epoch)throw new DOMException('账号已切换','AbortError')
  const boundary=text.lastIndexOf('\n',text.length-2),body=text.slice(0,boundary+1)
  let complete:any,manifest:any
  try{complete=JSON.parse(text.slice(boundary+1));manifest=JSON.parse(text.slice(0,text.indexOf('\n')))}catch{throw Error('导出未完整接收，请重新导出')}
  if(complete.type!=='complete'||manifest.type!=='manifest'||manifest.version!==1||manifest.merchant?.id!==session.merchant?.id)throw Error('导出未完整接收或商家不匹配，请重新导出')
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)),hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')
  if(hash!==complete.sha256)throw Error('导出文件校验失败，请重新导出')
  if(useAuth.getState().epoch!==session.epoch)throw new DOMException('账号已切换','AbortError')
  const url=URL.createObjectURL(new Blob([text],{type:'application/x-ndjson'})),link=document.createElement('a');link.href=url;link.download=`ZA-Thera-${session.merchant?.code}-${new Date().toISOString().slice(0,10)}.ndjson`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  return complete.records as number
 }finally{unsubscribe()}
}
