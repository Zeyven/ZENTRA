export type RoomService = {
  name: string; technician: string; state: string; expectedEnd: string | null;
  remainingSeconds: number | null; duration: number
}
export function roomServices(items: any[]): RoomService[] {
  return items.filter(i=>i.type==='SERVICE'&&!i.is_refund).map(i=>({
    name:i.service_name||i.item_name||'服务项目',technician:i.technician_name||'待派技师',
    state:i.clock_state??(i.status==='DONE'?'COMPLETED':!i.technician_id?'WAITING':!i.started_at?'ASSIGNED':'IN_SERVICE'),
    expectedEnd:i.expected_end_at??null,remainingSeconds:i.remaining_seconds??null,duration:Number(i.duration_minutes)||0
  }))
}
export function serviceStatus(service: RoomService, now=Date.now()): {state:string;label:string;urgent:boolean} {
  const labels:Record<string,string>={WAITING:'待派技师',ASSIGNED:'待接单',READY:'待上钟',PAUSED:'已暂停',COMPLETED:'已落钟',CANCELLED:'已退单'}
  if(labels[service.state])return {state:service.state,label:labels[service.state],urgent:['WAITING','ASSIGNED','READY'].includes(service.state)}
  if(!['IN_SERVICE','ENDING_SOON','OVERTIME'].includes(service.state))return {state:'UNKNOWN',label:'计时待确认',urgent:true}
  const end=Date.parse(service.expectedEnd??'')
  if(!Number.isFinite(end))return {state:'UNKNOWN',label:'计时待确认',urgent:true}
  const minutes=Math.ceil((end-now)/60000)
  if(minutes<=0)return {state:'OVERTIME',label:`已到时${minutes<0?' · 超时 '+Math.abs(minutes)+' 分钟':''}`,urgent:true}
  return {state:minutes<=10?'ENDING_SOON':'IN_SERVICE',label:`剩余 ${minutes} 分钟`,urgent:minutes<=10}
}
