import {useCallback,useEffect,useRef} from 'react'
import {useRealtime} from '../store/realtime'
import {toast} from '../store/toast'
/** Coalesce overlapping invalidations. Periodic checks only cover disconnection or a missed event. */
export function useAutoRefresh(load:()=>void|Promise<unknown>,intervalMs=30000,options:{pollWhenConnected?:boolean}={}):void{
 const version=useRealtime(s=>s.version),connected=useRealtime(s=>s.connected),callback=useRef(load),running=useRef(false),again=useRef(false),mounted=useRef(true)
 callback.current=load
 const refresh=useCallback(async()=>{
  if(running.current){again.current=true;return}running.current=true
  try{await callback.current()}catch(error){if(mounted.current&&!(error instanceof DOMException&&error.name==='AbortError'))toast(error instanceof Error?error.message:'数据读取失败，请重试','error')}
  finally{running.current=false;if(again.current&&mounted.current){again.current=false;void refresh()}}
 },[])
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 useEffect(()=>{void refresh()},[version,load,refresh])
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},connected&&!options.pollWhenConnected?Math.max(intervalMs,300000):intervalMs);return()=>clearInterval(timer)},[refresh,connected,intervalMs,options.pollWhenConnected])
}
