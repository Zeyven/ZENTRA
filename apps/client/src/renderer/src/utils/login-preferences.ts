const MERCHANT_KEY='za-spa-saas:remembered-merchant-accounts:v1',PLATFORM_KEY='za-spa-saas:remembered-platform-account:v1'
const read=(key:string)=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
const legacyCode=()=>{try{return localStorage.getItem('za-spa-saas:last-merchant')??''}catch{return ''}}
const save=(key:string,value:unknown)=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{/* Remembering an account is optional and cannot block login. */}}
export function merchantPreference(){const value=read(MERCHANT_KEY);return {enabled:value?.enabled!==false,code:typeof value?.code==='string'?value.code:legacyCode(),accounts:value?.accounts&&typeof value.accounts==='object'?value.accounts:{}}}
export function rememberedMerchantAccount(code:string){const p=merchantPreference();return p.enabled&&typeof p.accounts[code.trim().toUpperCase()]==='string'?p.accounts[code.trim().toUpperCase()]:''}
export function rememberMerchant(enabled:boolean,code:string,username:string){const key=code.trim().toUpperCase(),p=merchantPreference();const accounts=enabled?Object.fromEntries([...Object.entries(p.accounts).filter(([k])=>k!==key).slice(-9),[key,username.trim().toLowerCase()]]):{};save(MERCHANT_KEY,{enabled,code:enabled?key:'',accounts});try{if(enabled)localStorage.setItem('za-spa-saas:last-merchant',key);else localStorage.removeItem('za-spa-saas:last-merchant')}catch{}}
export function platformPreference(){const value=read(PLATFORM_KEY);return {enabled:value?.enabled!==false,username:typeof value?.username==='string'?value.username:''}}
export function rememberPlatform(enabled:boolean,username:string){save(PLATFORM_KEY,{enabled,username:enabled?username.trim().toLowerCase():''})}
