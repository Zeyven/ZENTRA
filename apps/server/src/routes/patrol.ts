import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id,input,idempotent,storeObject} from '../business.js';
import {DateOnly} from '../services/dates.js';
import {ensure} from '../errors.js';
export const patrolRouter=Router();
const access={store:true,roles:['manager','floor'],support:'read' as const};
async function today(){return (await tenantQuery("SELECT to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS day")).rows[0].day as string}
async function snapshot(store:number,date:string){
 const where="store_id=$1 AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Shanghai') AND created_at < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Shanghai')";
 const list=(await tenantQuery(`SELECT * FROM patrol_log WHERE ${where} ORDER BY id DESC LIMIT 200`,[store,date])).rows;
 const latest=(await tenantQuery(`SELECT DISTINCT ON(room_id) * FROM patrol_log WHERE ${where} ORDER BY room_id,id DESC`,[store,date])).rows;
 return {date,list,latest,summary:{total:latest.length,issues:latest.filter(r=>r.status==='issue').length}};
}
patrolRouter.get('/patrols',merchantRoute(access,async(req,a)=>snapshot(a.storeId!,req.query.date?DateOnly.parse(req.query.date):await today())));
patrolRouter.post('/patrol',merchantRoute({...access,support:undefined,write:true},async(req,a)=>idempotent(req,'patrol.record',async()=>{
 const b=z.object({room_id:Id,status:z.enum(['normal','issue']),remark:z.string().trim().max(1000).default(''),expected_id:z.number().int().nonnegative()}).strict().refine(b=>b.status!=='issue'||b.remark.length>0,'请填写异常说明').parse(input(req));
 const room=await storeObject('rooms',b.room_id,a.storeId!,true),date=await today();
 const previous=(await tenantQuery("SELECT id,to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS day FROM patrol_log WHERE store_id=$1 AND room_id=$2 ORDER BY id DESC LIMIT 1",[a.storeId,room.id])).rows[0];
 // A zero expectation means no record on the current business date, even if prior days exist.
 const current=previous?.day===date?previous:undefined;
 ensure((current?.id??0)===b.expected_id,409,'PATROL_CHANGED','房间巡查结果已被其他终端更新，请刷新核对');
 const row=(await tenantQuery('INSERT INTO patrol_log(store_id,room_id,room_name,status,remark,user_id,user_name) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[a.storeId,room.id,room.room_name||room.room_no,b.status,b.remark,a.user.id,a.user.name])).rows[0];
 await audit('room.patrol',{status:b.status,remark:b.remark,previous_id:previous?.id??null},'room',room.id);await event('room.patrol',room.id);
 return {record:row,...await snapshot(a.storeId!,date)};
})));
