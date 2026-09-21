import {readFile,stat} from 'node:fs/promises';
import {z} from 'zod';
const report=z.object({checked_at:z.iso.datetime({offset:true}),healthy:z.boolean(),problems:z.array(z.enum(['DISK_SPACE_LOW','BACKUP_STALE'])),disk_free_bytes:z.number().nonnegative(),latest_backup_at:z.iso.datetime({offset:true}).nullable()});
export async function backupHealth(path=process.env.BACKUP_STATUS_FILE??'/opt/za-spa-saas/health/backup.json',now=Date.now()){
 try{
  const file=await stat(path);if(!file.isFile()||file.size>16384)return {status:'unavailable',problems:['INVALID_STATUS_FILE']};
  const data=report.parse(JSON.parse(await readFile(path,'utf8'))),age=now-Date.parse(data.checked_at);
  if(age< -60000||age>30*60000)return {...data,status:'stale',healthy:false,problems:[...data.problems,'MONITOR_STALE']};
  return {...data,status:data.healthy?'healthy':'degraded'};
 }catch{return {status:'unavailable',healthy:false,problems:['BACKUP_STATUS_UNAVAILABLE']}}
}
