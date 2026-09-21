import {useEffect,useState,type InputHTMLAttributes} from 'react'
export default function PasswordInput(props:InputHTMLAttributes<HTMLInputElement>){
 const [visible,setVisible]=useState(false)
 useEffect(()=>{if(props.value==='')setVisible(false)},[props.value])
 if(props.type&&props.type!=='password')return <input {...props}/>
 return <span className="password-control"><input {...props} type={visible?'text':'password'}/><button type="button" aria-label={visible?'隐藏密码':'显示密码'} aria-pressed={visible} title={visible?'隐藏密码':'显示密码'} disabled={props.disabled} onClick={()=>setVisible(v=>!v)}><svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{visible&&<path d="m3 3 18 18"/>}</svg></button></span>
}
