import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {Id} from '../business.js';
import {ensure} from '../errors.js';
import {businessDate,DateOnly,dateRange,shiftDate} from '../services/dates.js';
import {collectorStatus} from '../services/maintenance.js';
export const maintenanceRouter=Router();
const access={store:true,roles:[],support:'read' as const};
const source=z.enum(['request','system','operation','audit','clock','realtime']);
type Source=z.infer<typeof source>;
const labels:Record<Source,string>={request:'接口请求',system:'系统运行',operation:'业务操作',audit:'敏感审计',clock:'报钟事件',realtime:'同步事件'};
const optional=<T extends z.ZodType>(schema:T)=>z.preprocess(v=>v===''?undefined:v,schema.optional());
const filters=z.object({source:source.default('request'),q:z.string().max(120).default(''),store_id:optional(Id),user_id:optional(Id),start:optional(DateOnly),end:optional(DateOnly),level:optional(z.enum(['info','warn','error'])),status_code:optional(z.coerce.number().int().min(100).max(599)),min_duration:optional(z.coerce.number().int().min(0).max(3600000)),before_id:optional(Id)}).strict();
function select(kind:Source){
 const suffix="NULL::uuid AS request_id,NULL::text AS method,NULL::text AS route,NULL::int AS status_code,NULL::int AS duration_ms";
 if(kind==='request'||kind==='system')return `SELECT id,store_id,user_id,created_at,source,level,request_id,method,route,status_code,duration_ms,route AS action,'{}'::jsonb AS detail FROM maintenance_events WHERE source='${kind}'`;
 if(kind==='audit'||kind==='operation')return `SELECT id,store_id,user_id,created_at,'${kind}'::text AS source,'info'::text AS level,${suffix},action,detail FROM audit_events ${kind==='operation'?"WHERE action NOT LIKE 'auth.%' AND action NOT LIKE 'support.%'":''}`;
 if(kind==='clock')return `SELECT id,store_id,user_id,created_at,'clock'::text AS source,'info'::text AS level,${suffix},action,jsonb_build_object('order_item_id',order_item_id) AS detail FROM clock_events`;
 return `SELECT id,store_id,NULL::bigint AS user_id,created_at,'realtime'::text AS source,'info'::text AS level,${suffix},topic AS action,jsonb_build_object('object_id',object_id) AS detail FROM domain_events`;
}
// Deliberately excludes free-form text, member identity, raw snapshots and secrets.
const detailKeys=new Set(['id','order_id','order_item_id','member_id','room_id','technician_id','item_id','object_id','store_id','status','version','amount','bonus','times','points','quantity','before','after','payment_method','kind','format','records','datasets','provider','channel','secret_changed']);
function safeDetail(value:unknown,depth=0):unknown{
 if(depth>4)return undefined;if(Array.isArray(value))return value.slice(0,100).map(v=>safeDetail(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>detailKeys.has(key)).map(([key,v])=>[key,safeDetail(v,depth+1)]));
 return typeof value==='string'?value.slice(0,100):value;
}
async function page(storeId:number,raw:unknown,limit=100,id?:number){
 const q=filters.parse(raw),range=dateRange({start_date:q.start??shiftDate(businessDate(),-29),end_date:q.end??businessDate()}),values:unknown[]=[storeId],conditions=['l.store_id=$1'];
 const add=(condition:string,value:unknown)=>{values.push(value);conditions.push(condition.replace('?',`$${values.length}`))};
 if(id)add('l.id=?',id);else{add('l.created_at>=?::timestamptz',range.from);add('l.created_at<?::timestamptz',range.until)}
 if(q.before_id)add('l.id<?',q.before_id);if(q.user_id)add('l.user_id=?',q.user_id);if(q.level)add('l.level=?',q.level);if(q.status_code)add('l.status_code=?',q.status_code);if(q.min_duration!==undefined)add('l.duration_ms>=?',q.min_duration);
 if(q.q){values.push('%'+q.q.replace(/[\\%_]/g,'\\$&')+'%');conditions.push(`(l.action ILIKE $${values.length} OR l.route ILIKE $${values.length} OR l.request_id::text ILIKE $${values.length})`)}
 values.push(limit+1);const rows=(await tenantQuery(`WITH logs AS (${select(q.source)}) SELECT l.*,u.name AS operator_name FROM logs l LEFT JOIN merchant_users u ON u.id=l.user_id AND u.merchant_id=require_merchant_id() WHERE ${conditions.join(' AND ')} ORDER BY l.id DESC LIMIT $${values.length}`,values)).rows;
 const items=rows.slice(0,limit).map(r=>({...r,detail:safeDetail(r.detail)}));return {source:q.source,rows:items,limit,has_more:rows.length>limit,next_cursor:rows.length>limit?items.at(-1)!.id:null};
}
maintenanceRouter.get('/maintenance/logs',merchantRoute(access,async(req,a)=>page(a.storeId!,req.query)));
maintenanceRouter.get('/maintenance/logs/:source/:id',merchantRoute(access,async(req,a)=>{const result=await page(a.storeId!,{source:source.parse(req.params.source)},1,Id.parse(req.params.id));ensure(result.rows[0],404,'NOT_FOUND','日志不存在或不属于当前门店');return result.rows[0]}));
maintenanceRouter.post('/maintenance/export',merchantRoute(access,async(req,a)=>{const result=await page(a.storeId!,req.query,500);await audit('maintenance.exported',{source:result.source,records:result.rows.length});return {...result,exported_at:new Date().toISOString()}}));
maintenanceRouter.get('/maintenance/summary',merchantRoute(access,async(_req,a)=>{
 const recent=(await tenantQuery(`SELECT count(*)::int AS requests,count(*) FILTER(WHERE status_code>=500)::int AS errors,count(*) FILTER(WHERE status_code BETWEEN 400 AND 499)::int AS rejected,count(*) FILTER(WHERE duration_ms>=1000)::int AS slow,coalesce(round(avg(duration_ms)),0)::int AS average_ms FROM maintenance_events WHERE store_id=$1 AND source='request' AND created_at>=now()-interval '24 hours'`,[a.storeId])).rows[0];
 const coverage=[];for(const kind of source.options){const latest=(await tenantQuery(`SELECT id,created_at FROM (${select(kind)}) l WHERE store_id=$1 ORDER BY id DESC LIMIT 1`,[a.storeId])).rows[0]??null;coverage.push({source:kind,label:labels[kind],latest})}
  return {version:'1.0.22',server_time:new Date().toISOString(),timezone:'Asia/Shanghai',uptime_seconds:Math.floor(process.uptime()),memory_mb:Math.round(process.memoryUsage().rss/1024**2),database_readable:true,collector:collectorStatus(a.merchant.id),retention:{days:30,max_rows:10000},recent,coverage};
}));


