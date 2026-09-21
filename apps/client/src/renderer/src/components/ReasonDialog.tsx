import {useEffect,useState} from 'react'
import {Modal} from './ui'
import {useAuth} from '../store/auth'
let pending:{resolve:(value:string)=>void;reject:(error:Error)=>void}|null=null
export function askReason(title:string,existing?:string):Promise<string>{
 if(existing?.trim())return Promise.resolve(existing.trim())
 if(pending)return Promise.reject(Error('请先完成当前原因输入'))
 return new Promise((resolve,reject)=>{pending={resolve,reject};window.dispatchEvent(new CustomEvent('saas:reason',{detail:title}))})
}
export default function ReasonDialog(){
 const [title,setTitle]=useState(''),[value,setValue]=useState(''),epoch=useAuth(s=>s.epoch)
 function cancel(){const request=pending;pending=null;setTitle('');request?.reject(new DOMException('操作已取消','AbortError'))}
 useEffect(()=>{const open=(event:Event)=>{setTitle((event as CustomEvent).detail);setValue('')};window.addEventListener('saas:reason',open);return()=>{window.removeEventListener('saas:reason',open);const request=pending;pending=null;request?.reject(new DOMException('操作已取消','AbortError'))}},[])
 useEffect(()=>cancel(),[epoch])
 return <Modal open={!!title} title={title} onClose={cancel} width="max-w-md" footer={<><button className="btn-secondary" onClick={cancel}>取消</button><button className="btn-primary" disabled={!value.trim()} onClick={()=>{const request=pending;pending=null;setTitle('');request?.resolve(value.trim())}}>确认并继续</button></>}><textarea aria-label={title} className="input" rows={3} maxLength={500} value={value} onChange={e=>setValue(e.target.value)} placeholder="请填写操作原因"/></Modal>
}
