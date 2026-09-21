import {merchantPreference,rememberedMerchantAccount,rememberMerchant} from '../utils/login-preferences'
import PasswordInput from '../components/PasswordInput'
import {useRef,useState} from 'react'
import {api} from '../api'
import {remote,isRemoteFailure} from '../api/transport'
import BrandMark from '../components/BrandMark'
import Icon from '../components/Icon'
import './login.css'
import {BRAND_NAME,BRAND_DESCRIPTION,BRAND_TAGLINE} from '../../../shared/brand'
export default function MerchantLogin(){
 const token=new URLSearchParams(location.search).get('token'),activating=location.pathname==='/activate'&&!!token
 const [remember,setRemember]=useState(()=>merchantPreference().enabled)
 const [form,setForm]=useState(()=>{const p=merchantPreference();return {merchant_code:activating?'':p.code,username:activating?'':rememberedMerchantAccount(p.code),password:'',name:'',confirm:''}})
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[activated,setActivated]=useState(false);const lock=useRef(false)
 const submit=async(event:React.FormEvent)=>{event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  if(activating&&!activated){if(form.password!==form.confirm)throw Error('两次输入的密码不一致');const result=await remote<any>('/api/merchant/v1/auth/activate',{method:'POST',body:JSON.stringify({token,username:form.username,password:form.password,name:form.name})});if(isRemoteFailure(result))throw Error(result.msg);setActivated(true);setForm(f=>({...f,password:'',confirm:''}));return}
  const result=await api.login(form.merchant_code,form.username,form.password);if(!result.ok)throw Error(result.msg);rememberMerchant(remember,form.merchant_code,form.username)
 }catch(e){setError(e instanceof Error?e.message:'登录失败')}finally{lock.current=false;setBusy(false)}}
 return <div className="login-shell">
 <section className="login-showcase">
  <div className="login-showcase-brand"><BrandMark className="h-12 w-12"/><div><strong>{BRAND_NAME}</strong><small>HOSPITALITY, IN HARMONY</small></div></div>
  <div className="login-copy"><div className="login-eyebrow">{BRAND_DESCRIPTION}</div><h1 aria-label={BRAND_TAGLINE}>{BRAND_TAGLINE.split('，').map((line,index)=><span key={line}>{line}{index===0?'，':''}</span>)}</h1><p>从每一次迎宾，到每一笔经营。<br/>连接门店、人和服务，让日常井然有序。</p></div>
  <div className="login-pillars"><div><span>01</span>门店经营</div><div><span>02</span>会员服务</div><div><span>03</span>连锁管理</div></div>
 </section>
 <main className="login-main"><div className="login-main-label"><span>ZA THERA / WORKSPACE</span><nav className="login-mode-switch" aria-label="登录入口"><span aria-current="page">{activating&&!activated?'邀请激活':'商家登录'}</span>{!window.saasDesktop&&<a href="/platform">平台登录</a>}</nav></div><form onSubmit={submit} className="login-form"><div>
  <div className="login-form-brand"><BrandMark className="h-11 w-11"/><div><p>{BRAND_NAME}</p><small>{BRAND_DESCRIPTION}</small></div></div>
  <p className="login-mobile-tagline">{BRAND_TAGLINE}</p>
  <h2>{activating&&!activated?'激活商家老板账号':'登录商家工作空间'}</h2><p className="login-intro">{activated?'账号已激活，请使用商家编号登录。':activating?'邀请只能使用一次，请设置你自己的密码。':'请输入平台为你的商家分配的商家编号。'}</p></div>
 {(!activating||activated)&&<label className="login-input-label">商家编号<input autoFocus required autoComplete="organization" className="input mt-2 uppercase" value={form.merchant_code} onChange={e=>setForm({...form,merchant_code:e.target.value.toUpperCase(),username:activated?form.username:rememberedMerchantAccount(e.target.value),password:''})} placeholder="例如 MC001"/></label>}
 {activating&&!activated&&<label className="login-input-label">姓名<input required className="input mt-2" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>}
 <label className="login-input-label">账号<input required autoComplete="username" className="input mt-2" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="手机号或账号"/></label>
 <label className="login-input-label">密码<PasswordInput required minLength={activating&&!activated?8:1} maxLength={activating&&!activated?20:128} autoComplete={activating?'new-password':'current-password'} type="password" className="input mt-2" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder={activating?'8–20 位字符':'请输入密码'}/></label>
 {activating&&!activated&&<label className="login-input-label">确认密码<PasswordInput required autoComplete="new-password" type="password" className="input mt-2" value={form.confirm} onChange={e=>setForm({...form,confirm:e.target.value})}/></label>}
 {(!activating||activated)&&<label className="flex items-center gap-2 mt-4 text-sm text-gray-600"><input type="checkbox" checked={remember} onChange={e=>{setRemember(e.target.checked);if(!e.target.checked)rememberMerchant(false,'','')}}/>记住商家和账号（不保存密码）</label>}
 {error&&<div role="alert" className="mt-5 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}<button className="btn-primary login-submit" disabled={busy}>{busy?'正在处理…':activating&&!activated?'激活账号':'登录'}{!busy&&<Icon name="arrow" size={18}/>}</button><p className="login-help">忘记商家编号或员工密码，请联系商家老板或平台管理员。</p>{!window.saasDesktop&&<a className="login-download" href="/updates/windows/stable/ZA-Thera-Setup.exe" download>下载 Windows 客户端<span>Windows 10 / 11 · 64 位</span></a>}</form><div className="login-footer">商家独立 · 多店协同 · 权限清晰</div></main></div>
}

