import {z} from 'zod';
import {ensure} from '../errors.js';
export const businessDate=(at=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
export const DateOnly=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
},'日期不存在');
export const Month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const shiftDate=(value:string,days:number)=>new Date(new Date(value+'T00:00:00Z').getTime()+days*86400000).toISOString().slice(0,10);
export function dateRange(query:Record<string,unknown>){
 const start=DateOnly.parse(query.start_date||query.date||businessDate()),end=DateOnly.parse(query.end_date||start);
 const days=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
 ensure(days>0&&days<=366,400,'INVALID_RANGE','日期范围须为 1 至 366 天');
 return {start,end,days,from:start+'T00:00:00+08:00',until:shiftDate(end,1)+'T00:00:00+08:00'};
}
export function monthRange(value:unknown){const month=Month.parse(value||businessDate().slice(0,7));const next=new Date(month+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);return {month,...dateRange({start_date:month+'-01',end_date:shiftDate(next.toISOString().slice(0,10),-1)})}}
