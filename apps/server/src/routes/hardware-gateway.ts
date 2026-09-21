import {Router,type RequestHandler} from 'express';
import {z} from 'zod';
import {isIPv4} from 'node:net';
import {merchantRoute,audit,event,bearer} from '../access.js';
import {inTenant,tenantQuery,platformPool} from '../db/pools.js';
import {digest,randomToken} from '../security.js';
import {ensure} from '../errors.js';
import {input,Id} from '../business.js';
import {clockSelect,clockView} from '../services/clocks.js';
export const gatewayManagementRouter=Router(),hardwareGatewayRouter=Router();
const prefix='/devices/gateways';
const fields='id,name,expires_at,revoked_at,last_seen_at,device_status,created_at';
gatewayManagementRouter.get(prefix,merchantRoute({store:true,roles:['manager'],support:'read'},async(_req,a)=>{
 const rows=(await tenantQuery(`SELECT ${fields} FROM hardware_gateways WHERE store_id=$1 ORDER BY created_at DESC LIMIT 100`,[a.storeId])).rows;
 const bindings=(await tenantQuery(`SELECT b.gateway_id,b.device_id,b.device_ip,b.room_id,r.room_no,r.active FROM hardware_bindings b JOIN rooms r ON r.merchant_id=b.merchant_id AND r.id=b.room_id WHERE r.store_id=$1 AND b.gateway_id=ANY($2::uuid[]) ORDER BY b.device_id`,[a.storeId,rows.map(g=>g.id)])).rows;
 return rows.map(g=>({...g,devices:bindings.filter(b=>b.gateway_id===g.id)}));
}));
gatewayManagementRouter.post(prefix,merchantRoute({store:true,write:true,owner:true},async(req,a)=>{
 const b=z.object({gateway_id:z.uuid(),name:z.string().trim().min(1).max(80),devices:z.array(z.object({room_id:Id,device_id:z.string().trim().min(1).max(100),device_ip:z.string().refine(isIPv4)}).strict()).min(1).max(100)}).strict().parse(input(req));
 ensure(new Set(b.devices.map(d=>d.device_id)).size===b.devices.length&&new Set(b.devices.map(d=>d.device_ip)).size===b.devices.length,400,'DUPLICATE_DEVICE','设备编号和IP不能重复');
 ensure(new Set(b.devices.map(d=>d.room_id)).size===b.devices.length,400,'DUPLICATE_ROOM_BINDING','同一网关内每个房间只能绑定一台面板');
 ensure(!(await tenantQuery('SELECT 1 FROM hardware_gateways WHERE id=$1',[b.gateway_id])).rowCount,409,'GATEWAY_EXISTS','此次授权已创建；若未收到密钥，请撤销后重新创建。密钥不能再次读取');
 const rooms=(await tenantQuery('SELECT id,room_no FROM rooms WHERE store_id=$1 AND active=1 AND id=ANY($2::bigint[])',[a.storeId,b.devices.map(d=>d.room_id)])).rows;
 ensure(b.devices.every(d=>rooms.some(r=>r.id===d.room_id)),403,'ROOM_FORBIDDEN','只能绑定本店启用的房间');
 const occupied=(await tenantQuery('SELECT room_id FROM hardware_bindings WHERE room_id=ANY($1::bigint[])',[b.devices.map(d=>d.room_id)])).rows;
 ensure(occupied.length===0,409,'ROOM_ALREADY_BOUND','所选房间已经绑定其他网关；请先撤销原网关授权后重新配置');
 const token=`gw1.${a.merchant.id}.${b.gateway_id}.${randomToken()}`;
 const saved=(await tenantQuery(`INSERT INTO hardware_gateways(id,store_id,name,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days') ON CONFLICT DO NOTHING RETURNING ${fields}`,[b.gateway_id,a.storeId,b.name,digest(token),a.user.id])).rows[0];
 ensure(saved,409,'GATEWAY_EXISTS','此次授权已创建；若未收到密钥，请撤销后重新创建。密钥不能再次读取');
 for(const d of b.devices)await tenantQuery('INSERT INTO hardware_bindings(gateway_id,room_id,device_id,device_ip) VALUES($1,$2,$3,$4)',[b.gateway_id,d.room_id,d.device_id,d.device_ip]);
 await audit('hardware.gateway.created',{gateway_id:b.gateway_id,room_ids:b.devices.map(d=>d.room_id)},'hardware_gateway',b.gateway_id);await event('device.changed');
 // Never pass this response through persisted idempotency storage or audit details.
 return {...saved,token,store_id:a.storeId,devices:b.devices.map(d=>({roomId:d.room_id,roomNo:rooms.find(r=>r.id===d.room_id).room_no,deviceId:d.device_id,ip:d.device_ip}))};
}));
gatewayManagementRouter.post(prefix+'/:id/revoke',merchantRoute({store:true,write:true,owner:true},async(req,a)=>{
 const id=z.uuid().parse(req.params.id);const row=(await tenantQuery(`UPDATE hardware_gateways SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND store_id=$2 RETURNING id`,[id,a.storeId])).rows[0];ensure(row,404,'NOT_FOUND','网关不存在');await audit('hardware.gateway.revoked',{},'hardware_gateway',id);await event('device.changed');return {id};
}));
function gatewayRoute(handler:(req:any,g:any)=>Promise<unknown>):RequestHandler{return async(req,res,next)=>{try{
 const token=bearer(req),parts=token.split('.');ensure(parts.length===4&&parts[0]==='gw1'&&z.uuid().safeParse(parts[1]).success&&z.uuid().safeParse(parts[2]).success&&/^[\w-]{43}$/.test(parts[3]),401,'INVALID_GATEWAY','需要独立网关授权');
 const data=await inTenant(parts[1],async()=>{
  const g=(await tenantQuery(`SELECT g.id,g.store_id,u.platform_user_id FROM hardware_gateways g JOIN merchants m ON m.id=g.merchant_id JOIN stores s ON s.merchant_id=g.merchant_id AND s.id=g.store_id JOIN merchant_users u ON u.merchant_id=g.merchant_id AND u.id=g.created_by WHERE g.id=$1 AND g.token_hash=$2 AND g.revoked_at IS NULL AND g.expires_at>now() AND m.status='active' AND s.status=1 AND u.active=1 AND (u.role='owner' OR u.platform_user_id IS NOT NULL) FOR UPDATE OF g FOR SHARE OF s,m,u`,[parts[2],digest(token)])).rows[0];
  ensure(g,401,'GATEWAY_REVOKED','网关授权已失效或门店已停用');
  if(g.platform_user_id)ensure((await platformPool.query('SELECT 1 FROM platform_users WHERE id=$1 AND active=true',[g.platform_user_id])).rowCount,401,'GATEWAY_REVOKED','网关授权的平台账号已停用');
  ensure(req.headers['x-store-id']===undefined||req.headers['x-store-id']===String(g.store_id),403,'STORE_FORBIDDEN','网关不可切换门店');
  ensure(Object.keys(req.query).length===0,400,'INVALID_QUERY','网关接口不接受门店或商家覆盖参数');
  return handler(req,g);
 });res.json({ok:true,data});
 }catch(e){next(e)}}}
hardwareGatewayRouter.get('/session',gatewayRoute(async(_req,g)=>{
 const store=(await tenantQuery('SELECT s.name,s.point_clock_business_type,m.name AS merchant_name FROM stores s JOIN merchants m ON m.id=s.merchant_id WHERE s.id=$1',[g.store_id])).rows[0];
 return {realm:'hardware',gateway_id:g.id,store_id:g.store_id,mode:'read-only',merchant_name:store.merchant_name,store_name:store.name,point_clock_business_type:store.point_clock_business_type,devices:(await tenantQuery('SELECT b.device_id,b.device_ip,b.room_id,r.room_no FROM hardware_bindings b JOIN rooms r ON r.merchant_id=b.merchant_id AND r.id=b.room_id WHERE b.gateway_id=$1 AND r.store_id=$2 AND r.active=1',[g.id,g.store_id])).rows};
}));
hardwareGatewayRouter.get('/rooms/:deviceId',gatewayRoute(async(req,g)=>{
 const deviceId=z.string().min(1).max(100).parse(req.params.deviceId);
 const room=(await tenantQuery('SELECT r.id,r.room_no,r.status FROM hardware_bindings b JOIN rooms r ON r.merchant_id=b.merchant_id AND r.id=b.room_id WHERE b.gateway_id=$1 AND b.device_id=$2 AND r.store_id=$3 AND r.active=1',[g.id,deviceId,g.store_id])).rows[0];ensure(room,404,'NOT_FOUND','设备未绑定本店房间');
 const clocks=(await tenantQuery(`${clockSelect} WHERE o.room_id=$1 AND o.store_id=$2 AND o.status='open' AND oi.item_type='service'`,[room.id,g.store_id])).rows.map(r=>clockView(r));
 return {room,clocks:clocks.filter(r=>!['COMPLETED','CANCELLED'].includes(r.state)).map(({technician_code,service_name,service_type,state,started_at,remaining_seconds})=>({technician_code,service_name,service_type,state,started_at,remaining_seconds}))};
}));
hardwareGatewayRouter.post('/heartbeat',gatewayRoute(async(req,g)=>{
 const b=z.object({devices:z.array(z.object({device_id:z.string().min(1).max(100),state:z.enum(['connected','disconnected','protocol_error'])}).strict()).max(100)}).strict().parse(req.body);
 const bound=(await tenantQuery('SELECT device_id FROM hardware_bindings WHERE gateway_id=$1',[g.id])).rows;ensure(b.devices.every(d=>bound.some(x=>x.device_id===d.device_id))&&new Set(b.devices.map(d=>d.device_id)).size===b.devices.length,400,'INVALID_DEVICE','只允许上报已绑定设备');
 await tenantQuery('UPDATE hardware_gateways SET last_seen_at=now(),device_status=$1 WHERE id=$2',[JSON.stringify(b.devices),g.id]);return {received:true};
}));
