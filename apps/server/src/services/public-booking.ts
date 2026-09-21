import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {context,tenantQuery,inTenant} from '../db/pools.js';
import {ensure} from '../errors.js';
import {Id,storeObject} from '../business.js';
import {randomToken,digest} from '../security.js';
import {audit,event} from '../access.js';
import {schedulingLock} from './reservations.js';
import {calculatePrice} from './pricing-engine.js';
const time=z.iso.datetime({offset:true}).refine(s=>Date.parse(s)>Date.now()&&Date.parse(s)<Date.now()+180*86400000,'预约时间须在未来 180 天内');
export const PublicBookingInput=z.object({customer_name:z.string().trim().min(1).max(64),customer_phone:z.string().regex(/^1\d{10}$/),service_item_id:Id,technician_id:Id.nullable().default(null),reserve_time:time,people:z.number().int().min(1).max(20).default(1),remark:z.string().trim().max(500).default('')}).strict();
type Booking=z.infer<typeof PublicBookingInput>;
export async function bookingQuote(input:Booking,exceptId?:number){
 const store=context().storeId!,item=await storeObject('items',input.service_item_id,store);ensure(item.active===1&&item.type==='service'&&!item.sold_out,409,'SERVICE_UNAVAILABLE','预约项目不可用');
 const tech=input.technician_id?await storeObject('technicians',input.technician_id,store):null;ensure(!tech||tech.active===1,409,'TECHNICIAN_UNAVAILABLE','技师不可预约');
 const duration=Math.max(15,item.duration||60);ensure(duration<=1440,409,'INVALID_DURATION','项目时长配置超出可预约范围');
 if(tech){const conflict=(await tenantQuery("SELECT 1 FROM reservations WHERE store_id=$1 AND technician_id=$2 AND id<>coalesce($5,0) AND status IN('pending','arrived','offered','awaiting_payment') AND reserve_time<$3::timestamptz+make_interval(mins=>$4) AND reserve_time+make_interval(mins=>duration)>$3 LIMIT 1",[store,tech.id,input.reserve_time,duration,exceptId??null])).rowCount;ensure(!conflict,409,'BOOKING_FULL','该技师此时段已有预约，可加入候补')}
 const room=(await tenantQuery(`SELECT rm.id FROM rooms rm WHERE rm.store_id=$1 AND rm.active=1 AND rm.status<>'maintenance' AND rm.capacity>=$2
 AND NOT EXISTS(SELECT 1 FROM reservations rv WHERE rv.room_id=rm.id AND rv.id<>coalesce($5,0) AND rv.status IN('pending','arrived','offered','awaiting_payment') AND rv.reserve_time<$3::timestamptz+make_interval(mins=>$4) AND rv.reserve_time+make_interval(mins=>rv.duration)>$3)
 ORDER BY rm.capacity,rm.sort_order,rm.id LIMIT 1`,[store,input.people,input.reserve_time,duration,exceptId??null])).rows[0];ensure(room,409,'BOOKING_FULL','该时段已满，可加入候补');
 const settings=Object.fromEntries((await tenantQuery("SELECT key,value FROM settings WHERE store_id=$1 AND key LIKE 'booking_%'",[store])).rows.map(r=>[r.key,r.value]));
 const at=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(input.reserve_time));
 const pricing=calculatePrice({basePrice:item.price,rules:(await tenantQuery('SELECT * FROM pricing_rules WHERE store_id=$1 AND enabled=1 ORDER BY priority,id',[store])).rows,context:{at,item_id:item.id,technician_level:tech?.level}});
 const value=new Decimal(settings.booking_deposit_value??0),amount=new Decimal(pricing.final_price).mul(input.people);const deposit=settings.booking_deposit_type==='percent'?amount.mul(value).div(100):value;
 ensure(value.gte(0)&&(settings.booking_deposit_type!=='percent'||value.lte(100)),409,'INVALID_BOOKING_POLICY','订金规则配置无效');
 return {room_id:room.id,duration,service_price:pricing.final_price,total_price:amount.toNumber(),base_price:item.price,pricing_rules:pricing.applied_rules,deposit_required:deposit.toDecimalPlaces(2).toNumber(),payment_available:false};
}
export async function createPublicBooking(input:Booking,source='web',tokenHash?:string,status='pending'){
 const quote=await bookingQuote(input);ensure(quote.deposit_required===0,409,'PAYMENT_NOT_CONNECTED','该预约需要线上订金，支付服务尚未接入，请联系门店预约');
 const token=tokenHash?null:randomToken(),hash=tokenHash??digest(token!);
 const row=(await tenantQuery(`INSERT INTO reservations(store_id,customer_name,customer_phone,service_item_id,technician_id,room_id,reserve_time,duration,people,remark,source,status,public_token,booking_quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,version,status,reserve_time,duration,people`,[context().storeId,input.customer_name,input.customer_phone,input.service_item_id,input.technician_id,quote.room_id,input.reserve_time,quote.duration,input.people,input.remark,source,status,hash,JSON.stringify(quote)])).rows[0];
 await audit('booking.created',{reservation_id:row.id,source},'reservation',row.id);await event('reservation.changed',row.id);return {...row,token,quote};
}
export async function publicReservation(id:number,token:string,lock=false){
 const row=(await tenantQuery('SELECT * FROM reservations WHERE id=$1 AND store_id=$2 AND public_token=$3'+(lock?' FOR UPDATE':''),[id,context().storeId,digest(token)])).rows[0];ensure(row,404,'NOT_FOUND','预约凭据无效');return row;
}
export function bookingView(row:any){return {id:row.id,status:row.status,version:row.version,customer_name:row.customer_name,reserve_time:row.reserve_time,duration:row.duration,people:row.people,service_item_id:row.service_item_id,technician_id:row.technician_id,deposit_required:row.deposit_required,payment_status:row.payment_status,quote:row.booking_quote?JSON.parse(row.booking_quote):null}}
export async function offerWaitlist(released?:{reserve_time:Date|string;service_item_id?:number|null;technician_id?:number|null}){
 const store=context().storeId!;
 const expired=(await tenantQuery("UPDATE booking_waitlist SET status='expired',version=version+1 WHERE store_id=$1 AND status='offered' AND expires_at<=now() RETURNING offered_reservation_id",[store])).rows;
 for(const entry of expired)await tenantQuery("UPDATE reservations SET status='cancelled',cancelled_at=now(),version=version+1 WHERE id=$1 AND status='offered'",[entry.offered_reservation_id]);
 await tenantQuery("UPDATE booking_waitlist SET status='expired',version=version+1 WHERE store_id=$1 AND status='waiting' AND coalesce(preferred_end,preferred_start)<=now()",[store]);
 const waiting=(await tenantQuery("SELECT * FROM booking_waitlist WHERE store_id=$1 AND status='waiting' AND coalesce(preferred_end,preferred_start)>now() ORDER BY created_at,id LIMIT 50 FOR UPDATE",[store])).rows;
 for(const row of waiting){
  const service=row.service_item_id??released?.service_item_id;if(!service)continue;
  const start=new Date(row.preferred_start).getTime(),end=new Date(row.preferred_end??row.preferred_start).getTime(),freed=released?new Date(released.reserve_time).getTime():NaN;
  const slot=Number.isFinite(freed)&&freed>=start&&freed<=end?freed:Math.max(start,Date.now()+15*60000);if(slot>end)continue;
  await tenantQuery('SAVEPOINT waitlist_offer');
  try{const booking=await createPublicBooking({customer_name:row.customer_name,customer_phone:row.customer_phone,service_item_id:service,technician_id:row.technician_id,reserve_time:new Date(slot).toISOString(),people:row.people,remark:'候补预约'},'waitlist',row.public_token,'offered');await tenantQuery("UPDATE booking_waitlist SET status='offered',offered_reservation_id=$1,expires_at=least(now()+interval '15 minutes',$3::timestamptz),notified_at=now(),version=version+1 WHERE id=$2",[booking.id,row.id,new Date(slot).toISOString()]);await event('reservation.changed',booking.id)}
  catch(e){await tenantQuery('ROLLBACK TO SAVEPOINT waitlist_offer');if(!['BOOKING_FULL','SERVICE_UNAVAILABLE','TECHNICIAN_UNAVAILABLE','PAYMENT_NOT_CONNECTED'].includes((e as any)?.code))throw e}
  finally{await tenantQuery('RELEASE SAVEPOINT waitlist_offer')}
 }
 if(expired.length||waiting.length)await event('booking.waitlist.changed');
}
export async function scanMerchantBookings(merchantId:string){return inTenant(merchantId,async()=>{if((await tenantQuery('SELECT status FROM merchants WHERE id=$1',[merchantId])).rows[0]?.status!=='active')return;const stores=(await tenantQuery("SELECT id FROM stores WHERE status=1 AND EXISTS(SELECT 1 FROM booking_waitlist w WHERE w.store_id=stores.id AND w.status IN('waiting','offered'))")).rows;for(const store of stores){context().storeId=store.id;await schedulingLock();await offerWaitlist()}},{role:'system'})}
