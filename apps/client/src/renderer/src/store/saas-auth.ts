import {create} from 'zustand'
import type {DataSourceMode,Store,User} from '../types'
export const SESSION_KEY='za-spa-saas:merchant-session:v1'
export interface MerchantIdentity{id:string;code:string;name:string;member_mode:'store'|'merchant';status:'active'|'suspended'}
interface AuthState{
 user:User|null;merchant:MerchantIdentity|null;realm:'merchant'|'support'|null;tenantRole:string|null;support:any;token:string|null;epoch:number;mode:DataSourceMode;stores:Store[];currentStoreId:number|null;
 setBootstrap:(value:any)=>void;setSession:(user:User,mode:DataSourceMode,stores?:Store[],storeId?:number|null)=>void;setCurrentStore:(id:number)=>void;replaceStores:(stores:Store[])=>void;updateStoreName:(id:number,name:string)=>void;clearSession:()=>void;
}
function effectiveUser(user:any,stores:any[],storeId:number|null){return {...user,role:user.role==='owner'?'owner':user.role==='support'?'support':stores.find(s=>s.id===storeId)?.role??'employee',technician_id:stores.find(s=>s.id===storeId)?.technician_id??null} as User}
export function savedSession(){try{const value=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');return value?.token&&value?.merchant?.id?value:null}catch{return null}}
export function isPlatformSuperadmin(){const s=useAuth.getState();return s.realm==='support'&&s.support?.scope==='platform_admin'}
export function canWriteBusiness(requireStore=false){
 const s=useAuth.getState();
 if(isPlatformSuperadmin())return !requireStore||s.stores.some(store=>store.id===s.currentStoreId);
 return (s.realm==='merchant'||s.realm==='support'&&s.support?.scope==='maintenance')&&s.merchant?.status==='active'&&(!requireStore||s.stores.some(store=>store.id===s.currentStoreId&&store.status===1));
}
export const useAuth=create<AuthState>((set,get)=>({
 user:null,merchant:null,realm:null,tenantRole:null,support:null,token:savedSession()?.token??null,epoch:0,mode:'remote',stores:[],currentStoreId:savedSession()?.current_store_id??null,
 setBootstrap:value=>{
  if(value?.protocol_version!==1||!['merchant','support'].includes(value.realm)||!value.merchant?.id||!Array.isArray(value.stores)||!value.user?.id)throw Error('商家会话协议无效')
  if(window.saasDesktop&&value.realm!=='merchant')throw Error('Windows 商家客户端仅接受商家员工会话')
  const token=value.token??get().token;if(!token)throw Error('登录凭证缺失');
  const stores=value.stores.map((s:any)=>({...s,role_code:'store',is_default:0}));const id=value.current_store_id??null;
  if(id&&!stores.some((s:any)=>s.id===id))throw Error('会话门店授权无效');
  const current=get(),nextUser=effectiveUser(value.user,stores,id),changed=current.token!==token||current.currentStoreId!==id||current.merchant?.id!==value.merchant.id||current.user?.role!==nextUser.role||current.user?.technician_id!==nextUser.technician_id;
  sessionStorage.setItem(SESSION_KEY,JSON.stringify({...value,token}));
  set({user:effectiveUser(value.user,stores,id),tenantRole:value.user.role,merchant:value.merchant,realm:value.realm,support:value.support??null,token,stores,currentStoreId:id,epoch:current.epoch+(changed?1:0),mode:'remote'});
 },
 setSession:()=>{throw Error('请使用经过服务端验证的 SaaS 会话')},
 setCurrentStore:id=>{
  const current=get(),store=current.stores.find(s=>s.id===id&&(s.status===1||current.tenantRole==='owner'||current.realm==='support'));if(!store)throw Error('门店未获授权');
  const value=savedSession();if(value)sessionStorage.setItem(SESSION_KEY,JSON.stringify({...value,current_store_id:id}));
  set({currentStoreId:id,user:effectiveUser({...current.user,role:current.tenantRole},current.stores,id),epoch:current.epoch+1});
 },
 replaceStores:stores=>{const current=get(),id=stores.some(s=>s.id===current.currentStoreId&&s.status===1)?current.currentStoreId:stores.find(s=>s.status===1)?.id??null;set({stores,currentStoreId:id,user:effectiveUser({...current.user,role:current.tenantRole},stores,id),epoch:current.epoch+(id!==current.currentStoreId?1:0)})},
 updateStoreName:(id,name)=>set(s=>({stores:s.stores.map(store=>store.id===id?{...store,name}:store)})),
 clearSession:()=>{sessionStorage.removeItem(SESSION_KEY);set(s=>({user:null,merchant:null,realm:null,tenantRole:null,support:null,token:null,stores:[],currentStoreId:null,epoch:s.epoch+1}))}
}))
