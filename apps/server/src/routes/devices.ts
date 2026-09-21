import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {idempotent,input} from '../business.js';
import {ensure} from '../errors.js';
import {AnnouncerDraft} from '@za-spa/contracts';
export const devicesRouter=Router();
const kind=z.enum(['receipt_printer','wristband_reader','cash_drawer','customer_display','room_panel','technician_announcer']);
const body=z.object({version:z.number().int().nonnegative(),name:z.string().trim().min(1).max(100),model:z.string().trim().max(100),transport:z.enum(['unknown','system','keyboard','usb','serial','network']),announcer_config:AnnouncerDraft.optional()}).strict();
const read={store:true,roles:['manager'],support:'read' as const},write={store:true,roles:['manager'],write:true,support:'configuration' as const};
devicesRouter.get('/devices',merchantRoute(read,async(_req,actor)=>(await tenantQuery('SELECT * FROM device_connections WHERE store_id=$1 ORDER BY kind',[actor.storeId])).rows.map(row=>({...row,status:'not_connected'}))));
devicesRouter.get('/devices/technician_announcer',merchantRoute(read,async(_req,actor)=>({connection:(await tenantQuery("SELECT * FROM device_connections WHERE store_id=$1 AND kind='technician_announcer'",[actor.storeId])).rows[0]??null,status:'not_connected'})));
async function saveDevice(actor:any,type:z.infer<typeof kind>,b:z.infer<typeof body>){
 await tenantQuery('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.merchant.id+':device:'+actor.storeId+':'+type]);
 const old=(await tenantQuery('SELECT * FROM device_connections WHERE store_id=$1 AND kind=$2 FOR UPDATE',[actor.storeId,type])).rows[0];ensure((old?.version??0)===b.version,409,'VERSION_CONFLICT','设备配置已变化，请刷新核对');
 ensure(type==='technician_announcer'||b.announcer_config===undefined,400,'ANNOUNCER_CONFIG_KIND','仅技师房播报器可以保存播报配置');
 const row=old?(await tenantQuery('UPDATE device_connections SET name=$1,model=$2,transport=$3,version=version+1,updated_at=now() WHERE id=$4 RETURNING *',[b.name,b.model,b.transport,old.id])).rows[0]:(await tenantQuery('INSERT INTO device_connections(store_id,kind,name,model,transport) VALUES($1,$2,$3,$4,$5) RETURNING *',[actor.storeId,type,b.name,b.model,b.transport])).rows[0];
 if(type==='technician_announcer'){
  const config=b.announcer_config??old?.announcer_config??AnnouncerDraft.parse({});
  await tenantQuery('UPDATE device_connections SET announcer_config=$1 WHERE id=$2',[JSON.stringify(config),row.id]);row.announcer_config=config;
 }
 await audit('device.configured',{before:old,after:row},'device_connection',row.id);await event(type==='technician_announcer'?'device.technician_announcer':'device.changed',row.id);return {...row,status:'not_connected'};
}
// Fixed lock order and one merchant transaction: batch failure must not leave a partially configured store.
devicesRouter.post('/devices/configure',merchantRoute(write,async(req,actor)=>idempotent(req,'device.configure.batch',async()=>{
 const request=z.object({devices:z.array(body.extend({kind:z.enum(['wristband_reader','technician_announcer'])})).min(1).max(2)}).strict().parse(input(req));
 ensure(new Set(request.devices.map(d=>d.kind)).size===request.devices.length,400,'DUPLICATE_DEVICE_KIND','每类设备只能选择一份配置');
 const results=[];
 for(const entry of [...request.devices].sort((a,b)=>a.kind.localeCompare(b.kind))){const {kind:type,...config}=entry;results.push(await saveDevice(actor,type,config))}
 return {devices:results};
})));
devicesRouter.put('/devices/:kind',merchantRoute(write,async(req,actor)=>idempotent(req,'device.configure:'+req.params.kind,()=>saveDevice(actor,kind.parse(req.params.kind),body.parse(input(req))))));

devicesRouter.post('/devices/:kind/test',merchantRoute({...write,support:undefined},async req=>{
 const type=kind.parse(req.params.kind);
 ensure(type!=='technician_announcer',409,'ANNOUNCER_NOT_CONNECTED','技师房播报器待厂商协议适配，未连接设备、未发送播报；当前电脑语音不代表远端播报成功');
 ensure(type!=='room_panel',409,'ROOM_PANEL_NOT_CONNECTED','点钟王接口待接入：尚未取得并适配厂商协议，未连接面板或发送上下钟指令');
 ensure(false,409,'DEVICE_NOT_CONNECTED','设备驱动尚未接入，未发送打印、读卡或开钱箱指令');
}));
