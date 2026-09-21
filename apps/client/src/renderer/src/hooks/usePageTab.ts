import {useEffect,useState} from 'react'

// Only navigation is kept in the URL; forms and credentials are never persisted here.
export function usePageTab<T extends string>(fallback:T,allowed:readonly T[]):[T,(value:T)=>void]{
 const read=():T=>{const value=new URLSearchParams(location.hash.split('?')[1]??'').get('tab');return allowed.includes(value as T)?value as T:fallback}
 const [tab,setTab]=useState<T>(read)
 useEffect(()=>{const change=()=>setTab(read());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[fallback,allowed.join(',')])
 function select(value:T){if(!allowed.includes(value))return;const params=new URLSearchParams(location.hash.split('?')[1]??'');params.set('tab',value);history.replaceState(null,'',location.pathname+location.search+(location.hash.split('?')[0]||'#/')+'?'+params.toString());setTab(value)}
 return [tab,select]
}
