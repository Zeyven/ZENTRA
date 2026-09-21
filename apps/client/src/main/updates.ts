export interface UpdateState {status:string;version?:string;message?:string;percent?:number}
export function createUpdateController(updater:any){
 let state:UpdateState={status:'idle'},checking:Promise<UpdateState>|undefined;
 updater.on('error',(error:Error)=>{state={...state,status:'error',message:error.message}});
 updater.on('update-available',(info:{version:string})=>{state={status:'available',version:info.version}});
 updater.on('update-not-available',()=>{state={status:'current'}});
 updater.on('download-progress',(progress:{percent:number})=>{state={...state,status:'downloading',percent:Math.max(0,Math.min(100,progress.percent))}});
 updater.on('update-downloaded',()=>{state={...state,status:'downloaded',percent:100}});
 async function check(){
  if(['downloading','downloaded','installing'].includes(state.status))return state;
  if(checking)return checking;
  state={status:'checking'};
  checking=(async()=>{try{await updater.checkForUpdates();return state}catch(e){state={status:'error',message:e instanceof Error?e.message:'检查更新失败'};throw e}finally{checking=undefined}})();
  return checking;
 }
 return {state:()=>({...state}),check,async download(){if(state.status!=='available')throw Error('当前没有可下载的更新');state={...state,status:'downloading',percent:0};try{await updater.downloadUpdate();return state}catch(e){state={...state,status:'error',message:e instanceof Error?e.message:'下载失败'};throw e}},install(){if(state.status!=='downloaded')throw Error('更新尚未下载完成');state={...state,status:'installing'};updater.quitAndInstall(false,true);return state}};
}
export function scheduleUpdateChecks(check:()=>Promise<unknown>,initialMs=15000,intervalMs=15*60*1000){
 const run=()=>{void check().catch((error)=>console.warn(JSON.stringify({event:'update.check_failed',message:error instanceof Error?error.message:String(error)})))};
 const initial=setTimeout(run,initialMs),interval=setInterval(run,intervalMs);
 initial.unref();interval.unref();return()=>{clearTimeout(initial);clearInterval(interval)};
}
