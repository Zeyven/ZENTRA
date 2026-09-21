import PasswordInput from './components/PasswordInput'
import {lazy,Suspense,useEffect,useState} from 'react'
import {useAuth} from './store/auth'
import {api} from './api'
import {toast} from './store/toast'
import {AsyncButton,Toaster,Modal} from './components/ui'
import Login from './pages/Login'
import Board from './pages/Board'
import ErrorBoundary from './components/ErrorBoundary'
import ReasonDialog from './components/ReasonDialog'
import DesktopTools from './components/DesktopTools'
import WebUpdateNotice from './components/WebUpdateNotice'
import {canAccess,ROLE_LABELS,setPermConfig,type PageKey} from './utils/permissions'
import BrandMark from './components/BrandMark'
import Icon from './components/Icon'
import {BRAND_NAME} from '../../shared/brand'
const Orders=lazy(()=>import('./pages/Orders')),Technicians=lazy(()=>import('./pages/Technicians')),ClockRoom=lazy(()=>import('./pages/ClockRoom')),ClockTerminal=lazy(()=>import('./pages/ClockTerminal'))
const Items=lazy(()=>import('./pages/Items')),Members=lazy(()=>import('./pages/Members')),Reservations=lazy(()=>import('./pages/Reservations')),Reports=lazy(()=>import('./pages/Reports'))
const Shift=lazy(()=>import('./pages/Shift')),Settings=lazy(()=>import('./pages/Settings')),Queue=lazy(()=>import('./pages/Queue')),Headquarters=lazy(()=>import('./pages/Headquarters'))
const OwnerConsole=lazy(()=>import('./pages/OwnerConsole')),PlatformConsole=lazy(()=>import('./pages/PlatformConsole'))
const PublicQueue=lazy(()=>import('./pages/PublicQueue'))
const PublicBooking=lazy(()=>import('./pages/PublicBooking'))
const PublicCoupons=lazy(()=>import('./pages/PublicCoupons'))
const Approvals=lazy(()=>import('./pages/Approvals'))
const NAV:Array<{key:PageKey;label:string}>=[
 {key:'board',label:'房态看板'},{key:'orders',label:'账单管理'},{key:'technicians',label:'技师钟房'},
 {key:'clockroom',label:'钟房排钟'},{key:'items',label:'项目商品'},{key:'members',label:'会员管理'},
 {key:'reservations',label:'预约登记'},{key:'queue',label:'排队叫号'},{key:'reports',label:'报表中心'},
 {key:'shift',label:'交接班'},{key:'settings',label:'门店设置'},{key:'headquarters',label:'连锁模板'},
 {key:'approvals',label:'审批中心'},{key:'organization',label:'商家管理'}]
function pageFromLocation():PageKey{const page=location.hash.slice(2).split('?')[0];return NAV.some(n=>n.key===page)?page as PageKey:'board'}
function MerchantApp(){
 const {user,token,merchant,support,realm,stores,currentStoreId,epoch,clearSession}=useAuth()
 useEffect(()=>{void window.saasDesktop?.gateway?.('stop').catch(()=>toast('未能确认本机网关停止，请关闭客户端后重新登录','error'));return()=>{void window.saasDesktop?.gateway?.('stop').catch(()=>toast('未能确认本机网关停止，请关闭客户端后重新登录','error'))}},[merchant?.id,currentStoreId,user?.id,realm])
 const [page,setPageState]=useState<PageKey>(pageFromLocation),[restoring,setRestoring]=useState(!!token&&!user),[restoreError,setRestoreError]=useState('')
 const [permissionEpoch,setPermissionEpoch]=useState(-1),[permissionError,setPermissionError]=useState(''),[connected,setConnected]=useState(false)
 const [,permissionsChanged]=useState(0)
 const [showPassword,setShowPassword]=useState(false),[password,setPassword]=useState({current:'',next:'',confirm:''})
 function setPage(target:PageKey){history.replaceState(null,'',location.pathname+location.search+'#/'+target);setPageState(target)}
 useEffect(()=>{const navigate=()=>setPageState(pageFromLocation());window.addEventListener('hashchange',navigate);return()=>window.removeEventListener('hashchange',navigate)},[])
 useEffect(()=>{
  if(user||!token){setRestoring(false);return}
  let disposed=false;setRestoring(true);setRestoreError('')
  api.refreshSession().catch(e=>{if(!disposed)setRestoreError(e.message)}).finally(()=>{if(!disposed)setRestoring(false)})
  return()=>{disposed=true}
 },[token,!!user])
 useEffect(()=>{
  setPermConfig(null);setPermissionEpoch(-1);setConnected(false);if(!user)return
  let disposed=false,unsubscribe:(()=>void)|undefined
  const permissions=()=>api.ownPermissions().then(value=>{if(!disposed){setPermConfig(value);setPermissionEpoch(epoch);setPermissionError('');permissionsChanged(v=>v+1)}}).catch(e=>{if(!disposed){setPermissionEpoch(-1);setPermissionError(e.message)}})
  void permissions()
  void api.subscribeRealtime(event=>{
   if(disposed)return
   setConnected(event?.event!=='connection-error'&&event?.event!=='disconnected')
   if(event?.event==='recovered'||event?.topics?.some((t:string)=>/^(access|stores|support)\./.test(t)))void api.refreshSession().then(()=>permissions()).catch(e=>{if(!disposed)setPermissionError(e.message)})
  }).then(stop=>{if(disposed)stop();else unsubscribe=stop})
  return()=>{disposed=true;unsubscribe?.();setPermConfig(null)}
 },[epoch,!!user])
 const visible=NAV.filter(n=>(currentStoreId||n.key==='organization')&&canAccess(user,n.key))
 useEffect(()=>{if(permissionEpoch===epoch&&user&&!visible.some(n=>n.key===page)&&visible[0])setPage(visible[0].key)},[permissionEpoch,epoch,page,visible.map(n=>n.key).join(',')])
 if(restoring)return <div className="p-8">正在验证登录…</div>
 if(!user)return <>{restoreError&&token?<div className="p-8 space-y-4"><p role="alert">{restoreError}</p><button className="btn-primary" onClick={()=>location.reload()}>重试连接</button><button className="btn-secondary ml-3" onClick={clearSession}>重新登录</button></div>:<Login/>}<Toaster/></>
 async function changePassword(){
  if(password.next!==password.confirm)throw Error('两次输入的新密码不一致')
  const result=await api.changePassword(user!.id,password.current,password.next)
  if(!result.ok)throw Error(result.msg??'修改失败')
  setShowPassword(false);setPassword({current:'',next:'',confirm:''});clearSession();toast('密码已修改，请重新登录')
 }
 function content(){
  if(permissionEpoch!==epoch)return <div className="p-6"><p role={permissionError?'alert':undefined}>{permissionError||'正在读取账号权限…'}</p>{permissionError&&<button className="btn-secondary mt-3" onClick={()=>location.reload()}>重试</button>}</div>
  if(!visible.length)return <div className="p-6">账号尚未获得门店授权，请联系商家老板。</div>
  if(!visible.some(n=>n.key===page))return <div className="p-6">正在切换页面…</div>
  if(new URLSearchParams(location.search).get('room-terminal')==='1')return <ClockTerminal/>
  if(page==='approvals')return <Approvals/>
  switch(page){case'board':return <Board onNav={setPage}/>;case'orders':return <Orders/>;case'technicians':return <Technicians/>;case'clockroom':return <ClockRoom/>;case'items':return <Items/>;case'members':return <Members/>;case'reservations':return <Reservations/>;case'queue':return <Queue/>;case'reports':return <Reports/>;case'shift':return <Shift/>;case'settings':return <Settings/>;case'headquarters':return <Headquarters/>;case'organization':return <OwnerConsole/>;default:return null}
 }
 return <div className="app-shell flex w-screen"><aside className="app-sidebar shrink-0 flex flex-col"><div className="sidebar-brand"><BrandMark className="w-9 h-9"/><div className="min-w-0"><b className="sidebar-brand-name">{BRAND_NAME}</b><div className="sidebar-brand-caption">{merchant?.name}</div></div></div>
 <nav aria-label="主导航" className="sidebar-navigation flex-1 overflow-auto">{stores.length>0&&<div className="sidebar-store"><label className="label" htmlFor="current-store">当前门店</label><select id="current-store" className="input" value={currentStoreId??''} onChange={e=>{useAuth.getState().setCurrentStore(Number(e.target.value));setPage('board')}}><option value="" disabled>请选择门店</option>{stores.map(s=><option value={s.id} key={s.id}>{s.name}{s.status===0?'（已停用）':''}</option>)}</select></div>}{visible.map((n,index)=><div key={n.key}>{(index===0||n.key==='reports')&&<p className="sidebar-group-label">{index===0?'门店运营':'经营管理'}</p>}<button aria-current={page===n.key?'page':undefined} onClick={()=>setPage(n.key)} className="sidebar-nav-item"><Icon name={n.key}/><span>{n.label}</span>{page===n.key&&<span className="sidebar-active-dot"/>}</button></div>)}</nav>
 <div className="sidebar-account"><div className="sidebar-person"><span className="sidebar-avatar">{user.name.slice(0,1)}</span><div><div className="sidebar-user-name">{user.name}</div><div className="sidebar-user-role">{realm==='support'?(support?.scope==='platform_admin'?'平台超级管理员':'平台协助'):ROLE_LABELS[user.role]}</div></div></div><div className="sidebar-account-actions">{realm==='support'&&<button className="btn-ghost" onClick={()=>{clearSession();location.assign('/platform')}}>返回技术后台</button>}{realm==='merchant'&&<button className="btn-ghost" onClick={()=>setShowPassword(true)}><Icon name="lock" size={14}/>修改密码</button>}<AsyncButton className="btn-ghost" onClick={async()=>{if(realm==='merchant'){const result=await api.logoutRemote();if(result?.ok===false)throw Error(result.msg)}clearSession()}}><Icon name="logout" size={14}/>退出登录</AsyncButton></div>{window.saasDesktop&&<div id="desktop-tools-entry" className="mt-2"/>}</div></aside>
 <main className="workspace-main flex-1 min-w-0 flex flex-col overflow-hidden"><div className="workspace-bar"><div className="workspace-breadcrumb"><span>{stores.find(s=>s.id===currentStoreId)?.name??merchant?.name}</span><span aria-hidden="true">/</span><strong>{NAV.find(n=>n.key===page)?.label}</strong></div>{import.meta.env.VITE_PREVIEW==='1'&&<span role="status" className="ml-auto mr-5 rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800">测试预览 · 隔离数据</span>}<div className="workspace-live" data-connected={connected}><span className="workspace-live-dot"/>{connected?'实时连接正常':'等待实时连接'}</div></div>{merchant?.status==='suspended'&&<div role="status" className="p-3 bg-amber-50 text-amber-800 text-sm">{support?.scope==='platform_admin'?'商家已停用，平台超级管理员仍可维护数据。':'商家已停用。您可以查看和导出经营记录。'}</div>}{support&&<div role="status" className="p-3 bg-blue-50 text-blue-800 text-sm">{support.scope==='platform_admin'?'平台超级管理 · 无需商家授权':'平台协助访问'} · {support.scope==='platform_admin'?'全部管理权限':support.scope==='maintenance'?'完整维护（含业务资产操作）':support.scope==='configuration'?'配置维护':'只读'} · 所有访问均会记录</div>}<div className="app-page flex-1 min-h-0" data-page={page} key={epoch}><ErrorBoundary><Suspense fallback={<div className="p-6">正在加载页面…</div>}>{content()}</Suspense></ErrorBoundary></div></main>
 <Modal open={showPassword} title="修改密码" onClose={()=>setShowPassword(false)} footer={<AsyncButton className="btn-primary" onClick={changePassword}>确认修改</AsyncButton>}><div className="space-y-3">{(['current','next','confirm'] as const).map(key=><label className="block" key={key}><span className="label">{{current:'当前密码',next:'新密码（8–20 位字符）',confirm:'确认新密码'}[key]}</span><PasswordInput className="input" type="password" autoComplete={key==='current'?'current-password':'new-password'} value={password[key]} onChange={e=>setPassword({...password,[key]:e.target.value})}/></label>)}</div></Modal><ReasonDialog/><Toaster/></div>
}
export default function App(){if(/^\/customer\/[^/]+\/[^/]+\/coupons\/?$/.test(location.pathname))return <ErrorBoundary><Suspense fallback={<div className="p-6">正在读取门店…</div>}><PublicCoupons/></Suspense></ErrorBoundary>;if(/^\/customer\/[^/]+\/[^/]+\/booking\/?$/.test(location.pathname))return <ErrorBoundary><Suspense fallback={<div className="p-6">正在读取门店…</div>}><PublicBooking/></Suspense></ErrorBoundary>;if(/^\/customer\/[^/]+\/[^/]+\/queue\/?$/.test(location.pathname))return <ErrorBoundary><Suspense fallback={<div className="p-6">正在读取门店…</div>}><PublicQueue/></Suspense></ErrorBoundary>;return <>{location.pathname.startsWith('/platform')?<ErrorBoundary><Suspense fallback={<div className="p-6">正在加载平台管理…</div>}><PlatformConsole/></Suspense><Toaster/></ErrorBoundary>:<MerchantApp/>}<DesktopTools/><WebUpdateNotice/></>}
