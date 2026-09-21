import {useEffect,useState} from 'react'
export default function WebUpdateNotice(){
 const [revision,setRevision]=useState(''),[dismissed,setDismissed]=useState('')
 useEffect(()=>{
  if(window.saasDesktop)return;
  const current=Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')).map(s=>new URL(s.src).pathname).find(p=>/\/assets\/index-[^/]+\.js$/.test(p));
  if(!current)return;
  let disposed=false,checking=false,lastCheck=0,controller:AbortController|undefined;
  const check=async()=>{
   if(disposed||checking||document.visibilityState==='hidden'||Date.now()-lastCheck<60000)return;
   checking=true;lastCheck=Date.now();controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),10000);
   try{
    const response=await fetch('/?update-check=1',{cache:'no-store',credentials:'omit',signal:controller.signal});if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return;
    const html=await response.text();if(html.length>65536)return;
    const doc=new DOMParser().parseFromString(html,'text/html');
    const next=Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')).map(s=>new URL(s.getAttribute('src')!,location.origin)).find(u=>u.origin===location.origin&&/\/assets\/index-[^/]+\.js$/.test(u.pathname))?.pathname;
    if(!disposed)setRevision(next&&next!==current?next:'');
   }catch{/* Network errors do not interrupt business; the next scheduled check will retry. */}finally{clearTimeout(timeout);checking=false}
  };
  void check();const timer=setInterval(()=>void check(),60000);const visible=()=>void check();document.addEventListener('visibilitychange',visible);window.addEventListener('online',visible);
  return()=>{disposed=true;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible)};
 },[])
 if(!revision||revision===dismissed)return null;
 return <aside role="status" aria-label="网页更新提醒" className="fixed right-4 bottom-5 z-50 max-w-sm rounded-xl border border-green-200 bg-white p-5 shadow-lg"><p className="font-semibold">网页有新版本</p><p className="my-3 text-sm text-gray-600">请先完成或保存当前操作，再刷新使用新版。</p><div className="flex gap-3"><button className="btn-primary" onClick={()=>{if(window.confirm('确认已完成或保存当前操作？刷新会重新加载页面。'))location.reload()}}>刷新使用新版</button><button className="btn-secondary" onClick={()=>setDismissed(revision)}>本次忽略</button></div></aside>
}
