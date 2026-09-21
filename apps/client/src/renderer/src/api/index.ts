import {roomServices} from '../utils/room-operations'
import type {MerchantTemplate,TemplateType,TemplatePreview} from '@za-spa/contracts'
import type {Category,DataSourceMode,Item,Member,Order,Reservation,Room,SessionBootstrap,Shift,Technician,User,Wristband} from '../types'
import {useAuth} from '../store/auth'
import {useRealtime} from '../store/realtime'
import {uuid} from '../utils/uuid'
import type {LogPage,LogSource,MaintenanceLog,MaintenanceSummary} from '../types/maintenance'
import {remote,isRemoteFailure,subscribeRealtime,expectedVersion,rememberOrder,cachedOrder} from './transport'
import {askReason} from '../components/ReasonDialog'
export {getServerUrl,setServerUrl} from './transport'
export const hasLocalBridge=()=>false
const P='/api/merchant/v1'
const snapshot=()=>remote<any>(P+'/snapshot')
const query=(values:Record<string,string|undefined>)=>{const params=new URLSearchParams(Object.entries(values).filter(([,v])=>!!v) as [string,string][]);return params.size?'?'+params:''}
const pick=(value:any,keys:string[])=>Object.fromEntries(keys.filter(key=>value[key]!==undefined&&!(key==='id'&&!value[key])).map(key=>[key,value[key]]))
async function requireResult<T>(pending:Promise<T>):Promise<T>{const result=await pending;if(isRemoteFailure(result))throw Error(result.msg);return result}
function mapRoom(resource: any): Room {
  const statusMap: Record<string,
    string> = { AVAILABLE: 'idle',
    OCCUPIED: 'occupied',
    CLEANING: 'cleaning',
    RESERVED: 'reserved',
    MAINTENANCE: 'maintenance',
    DISABLED: 'disabled' }
  const serviceItems = (resource.items || []).filter((item: any) => item.type === 'SERVICE' && !item.is_refund)
  const activeService = serviceItems.find((item: any) => item.status === 'IN_PROGRESS')
  // 房间在服务落钟后仍处于占用、待结账状态。此时保留最后一位已派技师，
  // 避免房态卡片把“已落钟”误显示成“未派钟”；技师忙闲状态仍由后端独立返回。
  const displayService = activeService || [...serviceItems].reverse().find((item: any) => item.technician_id)
  return {
    id: Number(resource.id), room_no: resource.code, room_name: resource.name, room_type: resource.room_type, capacity: Number(resource.capacity),
    status: statusMap[resource.status] || resource.status.toLowerCase(), sort_order: Number(resource.sort_order), order_id: resource.session_id ? Number(resource.session_id) : null,
    customer_name: resource.guest_name, technician_name: displayService?.technician_name, technician_code: displayService?.technician_no,
    services: roomServices(resource.items || []), opened_at: resource.opened_at, subtotal: Number(resource.total || 0)
  }
}
async function remoteOrder(id:number){return checkedOrder(cachedOrder(id)??await remote(P+'/orders/'+id),id)}
function checkedOrder(order:any,id:number):Order{if(!order||order.id!==id||!Array.isArray(order.items)||!['open','suspended','closed','cancelled'].includes(order.status)||!['subtotal','discount','payable','paid'].every(key=>Number.isFinite(order[key])))throw Error('订单响应无效，请核对记录，勿重复提交');return rememberOrder(order)}
async function orderFromMutation(result:any,id:number){return checkedOrder(result?.order,id)}
async function mutateOrder(id:number,action:string,body:any,key?:string){const result=await remote<any>(P+'/sessions/'+id+'/'+action,{method:'POST',...(key?{headers:{'Idempotency-Key':key}}:{}),body:JSON.stringify(body)});if(isRemoteFailure(result))return result;return {ok:true as const,order:checkedOrder(result.order,id)}}
async function mutateItem(p:any,action:string,body:any){const result=await remote<any>(P+'/session-items/'+p.item_id+'/'+action,{method:'POST',body:JSON.stringify({...body,version:p.version??expectedVersion(p.order_id)})});if(isRemoteFailure(result))return result;return {ok:true as const,order:checkedOrder(result.order,p.order_id)}}
export const api={
login: async (merchant_code:string,username:string,password:string):Promise<any>=>{const result=await remote<any>(P+'/auth/login',{method:'POST',body:JSON.stringify({merchant_code,username,password})});if(isRemoteFailure(result))return result;useAuth.getState().setBootstrap(result);return {ok:true as const,user:useAuth.getState().user,bootstrap:result}},
selectStore: async(storeId:number)=>{const result=await remote<any>(P+'/session',{headers:{'X-Store-ID':String(storeId)}});useAuth.getState().setBootstrap(result);return result},
refreshSession: async(resetStore=false)=>{const preferred=resetStore?null:useAuth.getState().currentStoreId;const result=await remote<any>(P+'/session',{headers:{'X-Store-ID':''}});if(preferred&&result.stores.some((store:any)=>store.id===preferred))result.current_store_id=preferred;useAuth.getState().setBootstrap(result);return result},
logoutRemote: async()=>remote<any>(P+'/auth/logout',{method:'POST',body:'{}'}),
changePassword: async(_id:number,current_password:string,new_password:string)=>{const result=await remote<any>(P+'/auth/password',{method:'POST',body:JSON.stringify({current_password,new_password})});if(!isRemoteFailure(result))useAuth.getState().clearSession();return result},
listUsers: () => remote<any[]>("/api/merchant/v1/users"),
reservationStaff: () => remote<{
    id: number;
    name: string;
}[]>("/api/merchant/v1/reservation-staff"),
saveUser: (u: any, operatorId: number) => remote("/api/merchant/v1/users", { method: "POST", body: JSON.stringify(u) }),
// rooms
listRooms: async (): Promise<Room[]> => (await snapshot()).resources.map(mapRoom),
saveRoom: (room:any,_operatorId:number)=>remote(P+'/rooms',{method:'POST',body:JSON.stringify(pick(room,['id','room_no','room_name','room_type','capacity','sort_order']))}),
deleteRoom: (id: number, operatorId: number) => remote(`/api/merchant/v1/rooms/${id}`, { method: "DELETE" }),
setRoomStatus: (id: number, status: string, operatorId: number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/rooms/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
// wristbands
setWristbandBinding: (id: number, data: {
    room_id: number | null;
    card_uid: string | null;
    reason: string;
}) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/wristbands/${id}/binding`, { method: "POST", body: JSON.stringify(data) }),
resolveWristband: (card: string) => remote<{
    code: string;
    room_id: number;
    room_no: string;
    room_name: string;
    status: string;
    order_id: number | null;
}>(`/api/merchant/v1/wristbands/resolve?card=${encodeURIComponent(card)}`),
listWristbands: (includeInactive=false) => remote<Wristband[]>("/api/merchant/v1/wristbands"+(includeInactive?"?include_inactive=1":"")),
addWristbands: (codes:string[],_operatorId:number)=>remote<any>(P+'/wristbands/batch',{method:'POST',body:JSON.stringify({codes})}),
removeWristband: (id: number, operatorId: number) => remote(`/api/merchant/v1/wristbands/${id}`, { method: "DELETE" }),
// technicians
getClocks: () => remote<any>("/api/merchant/v1/clocks"),
roomWarnings: async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        return await remote<any>("/api/merchant/v1/clocks/warnings", { signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
},
broadcastRoomWarning: async (request_key: string) => {
    const result = await remote<{
        room_count: number;
        warning_ids: number[];
    }>("/api/merchant/v1/clocks/warnings/broadcast", { method: "POST", body: JSON.stringify({ request_key }) });
    if (isRemoteFailure(result))
        throw new Error(result.msg);
    if (!Number.isSafeInteger(result.room_count) || result.room_count < 1 || result.warning_ids?.length !== result.room_count)
        throw new Error("\u5168\u5E97\u9884\u8B66\u7ED3\u679C\u672A\u786E\u8BA4\uFF0C\u8BF7\u91CD\u8BD5");
    return result;
},
sendRoomWarning: async (room_id: number, message: string, request_key: string) => {
    const result = await remote<{
        id: number;
    }>("/api/merchant/v1/clocks/warnings", { method: "POST", body: JSON.stringify({ room_id, message, request_key }) });
    if (isRemoteFailure(result))
        throw new Error(result.msg);
    if (!result.id)
        throw new Error("\u53D1\u9001\u7ED3\u679C\u672A\u786E\u8BA4\uFF0C\u8BF7\u4FDD\u7559\u5185\u5BB9\u91CD\u8BD5");
    return result;
},
roomWarningAction: async (id: number, action: "acknowledge" | "cancel") => {
    const result = await remote<{
        id: number;
    }>(`/api/merchant/v1/clocks/warnings/${id}/${action}`, { method: "POST", body: "{}" });
    if (isRemoteFailure(result))
        throw new Error(result.msg);
    if (result.id !== id)
        throw new Error("\u64CD\u4F5C\u7ED3\u679C\u672A\u786E\u8BA4\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5");
    return result;
},
clockAction: (id: number, action: string, payload: Record<string, unknown>) => remote<any>(`/api/merchant/v1/clocks/${id}/${action}`, { method: "POST", body: JSON.stringify(payload) }),
clockSettings: (confirmation_mode: boolean) => requireResult(remote<any>("/api/merchant/v1/clocks/settings", { method: "POST", body: JSON.stringify({ confirmation_mode }) })),
listTechnicians: async (): Promise<Technician[]> => (await snapshot()).technicians.map((row: any) => ({
    id: Number(row.id), name: row.display_name, code: row.technician_no, phone: row.phone, level: row.level || "\u6280\u5E08", status: row.clock_status === "BUSY" ? "serving" : row.clock_status === "OFF_DUTY" ? "off" : row.clock_status === "BREAK" ? "rest" : "on", base_salary: Number(row.base_salary || 0), commission_rate: Number(row.commission_rate || 0),
    wheel_rate: Number(row.wheel_rate || 0), dianzhong_rate: Number(row.dianzhong_rate || 0), half_rate: Number(row.half_rate || 0), add_time_rate: Number(row.add_time_rate || 0), dianzhong_bonus: Number(row.dianzhong_bonus || 0),
    queue_position: Number(row.queue_position ?? row.sort_order ?? 0), current_room: row.resource_code || null,
    reserved_today: Number(row.reserved_today || 0), served_today: Number(row.served_today || 0)
})),
subscribeRealtime: (onChange:(event?:any)=>void,_all=false)=>subscribeRealtime(onChange),
saveTechnician: (tech:any,_operatorId:number)=>remote(P+'/technicians',{method:'POST',body:JSON.stringify(pick(tech,['id','name','code','phone','level','base_salary','commission_rate','wheel_rate','dianzhong_rate','half_rate','dianzhong_bonus','add_time_rate']))}),
deleteTechnician: (id: number, operatorId: number) => remote(`/api/merchant/v1/technicians/${id}`, { method: "DELETE" }),
clockTechnician: (id: number, operatorId: number) => requireResult(remote<{ok:true;status:string}>(`/api/merchant/v1/technicians/${id}/clock`, { method: "POST", body: "{}" })),
listAttendance: (date: string) => remote<any[]>(`/api/merchant/v1/attendance?date=${encodeURIComponent(date)}`),
listMonthlyAttendance: (month?: string) => remote<any[]>(`/api/merchant/v1/attendance/monthly?month=${encodeURIComponent(month || "")}`),
listCategories: ()=>remote<Category[]>(P+'/categories'),
saveCategory: (c: any, operatorId: number) => remote("/api/merchant/v1/categories", { method: "POST", body: JSON.stringify(c) }),
deleteCategory: (id: number, operatorId: number) => remote(`/api/merchant/v1/categories/${id}`, { method: "DELETE" }),
listItems: ()=>remote<Item[]>(P+'/items'),
saveItem: (item:any,_operatorId:number)=>remote(P+'/items',{method:'POST',body:JSON.stringify(pick(item,['id','name','category_id','type','price','duration','commission','stock','low_stock_threshold','cost','unit','sold_out','is_primary']))}),
deleteItem: (id: number, operatorId: number) => remote(`/api/merchant/v1/items/${id}`, { method: "DELETE" }),
moveInventory: (m: any, operatorId: number) => remote("/api/merchant/v1/inventory/move", { method: "POST",headers:m.idempotency_key?{'Idempotency-Key':m.idempotency_key}:undefined, body: JSON.stringify(pick(m,['item_id','type','qty','remark','approval_id'])) }),
listInventory: () => remote<any[]>("/api/merchant/v1/inventory"),
inventoryOverview: () => remote<any>("/api/merchant/v1/inventory/overview"),
stocktakeInventory: (p: {
    items: {
        item_id: number;
        counted_qty: number;
        expected_stock:number;
    }[];
    remark?: string;
    reason?: string;
    approval_id?: number;
    idempotency_key?: string;
}, operatorId: number) => remote<any>("/api/merchant/v1/inventory/count", { method: "POST",headers:p.idempotency_key?{'Idempotency-Key':p.idempotency_key}:undefined, body: JSON.stringify({items:p.items.map(i=>({item_id:i.item_id,actual_qty:i.counted_qty,expected_stock:i.expected_stock})),remark:p.remark??p.reason,approval_id:p.approval_id}) }),
// members
listMembers: async (keyword?: string) => (await remote<any[]>(`/api/merchant/v1/members?keyword=${encodeURIComponent(keyword || "")}`)).map((m) => ({ ...m, id: Number(m.id), balance: Number(m.balance), bonus_balance: Number(m.bonus_balance), times_balance: Number(m.times_balance), points: Number(m.points), discount: Number(m.discount), status: m.status === "active" || m.status === "ACTIVE" ? "active" : "frozen" })),
searchCashierMembers:(keyword:string)=>remote<Member[]>(P+'/members/search?keyword='+encodeURIComponent(keyword)),
getMember: async(id:number)=>{const {transactions,profile,favoriteItems,coupons,...member}=await remote<any>(P+'/members/'+id);return {member,transactions,profile,favoriteItems,coupons}},
saveMember: async(m:any,_operatorId:number)=>{const body=pick(m,['id','name','phone','card_no','card_type','discount','salesman','tags','level','birthday','expiry']);if(!body.card_no)delete body.card_no;if(!m.id){Object.assign(body,pick(m,['balance','bonus_balance','times_balance','points']));if([m.balance,m.bonus_balance,m.times_balance,m.points].some(v=>Number(v)>0))body.reason=await askReason('期初会员权益原因',m.reason)}return remote<any>(P+'/members',{method:'POST',body:JSON.stringify(body)})},
deleteMember: (id: number, operatorId: number) => remote(`/api/merchant/v1/members/${id}`, { method: "DELETE" }),
rechargeMember: (p:any,_operatorId:number)=>remote<any>(P+'/members/recharge',{method:'POST',...(p.idempotency_key?{headers:{'Idempotency-Key':p.idempotency_key}}:{}),body:JSON.stringify({customer_id:p.member_id,amount:Number(p.amount),gift_amount:Number(p.bonus||0),times:p.times||0,method:p.method||'现金',...(p.plan_id?{plan_id:p.plan_id}:{})})}),
adjustMember: async(p:any,_operatorId:number)=>remote<any>(P+'/members/'+p.member_id+'/adjust',{method:'POST',body:JSON.stringify({version:p.version,principal:p.principal??p.amount??0,bonus:p.bonus??0,times:p.times??0,points:p.points??0,reason:await askReason('会员权益调整原因',p.reason)})}),
setMemberStatus: (p:any,_operatorId:number)=>remote<any>(P+'/members/'+p.member_id+'/status',{method:'POST',body:JSON.stringify({status:p.status==='active'?'active':'frozen'})}),
listOrders: (status?:string,date?:string)=>remote<Order[]>(P+'/orders'+query({status,date})),
getOrder: (id: number) => remoteOrder(id),
openOrder: async(p:any,_operatorId:number):Promise<any>=>{const result=await remote<any>(P+'/sessions',{method:'POST',body:JSON.stringify({resource_id:p.room_id,guest_name:p.customer_name||'',customer_id:p.member_id||null,...(p.wristband_no?{wristband_no:p.wristband_no}:{}),...(p.deposit!==undefined?{deposit:p.deposit}:{})})});if(isRemoteFailure(result))return result;const order=checkedOrder(result.order,result.id);return {ok:true as const,order,order_no:order.order_no,order_id:order.id}},
addItems: async(p:any,_operatorId:number)=>{let order:Order|undefined;let version=p.version??expectedVersion(p.order_id);for(const item of p.items){const result=await remote<any>(P+'/sessions/'+p.order_id+'/items',{method:'POST',body:JSON.stringify({version,catalog_id:item.item_id,quantity:Number(item.quantity),technician_id:item.technician_id||null,service_type:item.service_type||'轮钟'})});if(isRemoteFailure(result))return result;order=checkedOrder(result.order,p.order_id);version=order.version!}return {ok:true as const,order}},
refundItem: async(p:any,_operatorId:number)=>mutateItem(p,'refund',{reason:await askReason('退单原因',p.reason)}),
giftItem: async(p:any,_operatorId:number)=>mutateItem(p,'gift',{reason:await askReason('赠送原因',p.reason)}),
changePrice: async(p:any,_operatorId:number)=>mutateItem(p,'price',{price:p.price,reason:await askReason('改价原因',p.reason)}),
addTime: async(p:any,_operatorId:number)=>mutateItem(p,'add-time',{minutes:p.minutes}),
changeRoom: async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'change-room',{version:p.version??expectedVersion(p.order_id),room_id:p.room_id}),
changeTechnician: async(p:any,_operatorId:number)=>mutateItem(p,'technician',{technician_id:p.technician_id}),
endService: async(p:any,_operatorId:number)=>mutateItem(p,'end',{reason:await askReason('结束服务原因',p.reason)}),
bindMember: async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'bind-member',{version:p.version??expectedVersion(p.order_id),member_id:p.member_id??null,customer_name:p.customer_name}),
applyDiscount: async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'discount',{version:p.version??expectedVersion(p.order_id),discount:p.discount,reason:await askReason('优惠原因',p.reason)}),
settle: async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'checkout',{version:p.version??expectedVersion(p.order_id),payments:p.payments},p.idempotency_key),
reverseSettle: async(id:number,_operatorId:number,version=expectedVersion(id))=>mutateOrder(id,'reverse-checkout',{version,reason:await askReason('反结账原因')}),
cancelOrder: async(id:number,_operatorId:number,version=expectedVersion(id))=>mutateOrder(id,'cancel',{version,reason:await askReason('取消订单原因')}),
suspendOrder: async(id:number,_operatorId:number,version=expectedVersion(id))=>mutateOrder(id,'suspend',{version}),
resumeOrder: async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'resume',{version:p.version??expectedVersion(p.order_id),...(p.room_id?{room_id:p.room_id}:{})}),
linkOrder: async (p: {
    order_id: number;
    target_order_id: number;
}, operatorId: number) => {
    const res = await remote<{
        group_no: string;
    }>("/api/merchant/v1/order-groups/link", { method: "POST", body: JSON.stringify(p) });
    if (isRemoteFailure(res))
        return res;
    return { ok: true as const, group_no: res.group_no };
},
unlinkOrder: async (orderId: number, operatorId: number) => {
    const result = await remote(`/api/merchant/v1/order-groups/${orderId}`, { method: "DELETE" });
    if (isRemoteFailure(result))
        return result;
    return { ok: true as const };
},
listOrderGroup: async (orderId: number): Promise<{
    id: number;
    order_no: string;
    room_name?: string;
    room_no?: string;
    status: string;
    subtotal: number;
    payable: number;
}[]> => {
    return remote<{
        id: number;
        order_no: string;
        room_name?: string;
        room_no?: string;
        status: string;
        subtotal: number;
        payable: number;
    }[]>(`/api/merchant/v1/order-groups/${orderId}`);
},
// reservations
listReservations: async (status?: string) => (await remote<any[]>(`/api/merchant/v1/reservations?status=${encodeURIComponent(status || "")}`)).map((r) => ({ ...r, id: Number(r.id), room_id: r.room_id ? Number(r.room_id) : null, people: Number(r.people), status: ({ RESERVED: "pending", CONFIRMED: "confirmed", ARRIVED: "arrived", COMPLETED: "completed", CANCELLED: "cancelled" } as Record<string, string>)[r.status] || String(r.status).toLowerCase() })),
saveReservation: (r: any, operatorId: number) => remote("/api/merchant/v1/reservations", { method: "POST", body: JSON.stringify(r) }),
setReservationStatus: (id: number, status: string, operatorId: number,version:number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/reservations/${id}/status`, { method: "POST", body: JSON.stringify({ status,version }) }),
deleteReservation: (id: number, operatorId: number,version:number) => remote(`/api/merchant/v1/reservations/${id}`, { method: "DELETE",body:JSON.stringify({version}) }),
// shifts
currentShift: (operatorId: number) => remote<Shift | null>("/api/merchant/v1/shifts?current=1"),
startShift: async (startCash: number, operatorId: number) => ({ ok: true as const, ...(await remote<any>("/api/merchant/v1/shifts/start", { method: "POST", body: JSON.stringify({ start_cash: startCash }) })) }),
endShift: async (note: string, operatorId: number,actual_cash?:number,expected_cash?:number,expected_shift_id?:number) => ({ ok: true as const, ...(await remote<any>("/api/merchant/v1/shifts/end", { method: "POST", body: JSON.stringify({ note,actual_cash,expected_cash,expected_shift_id }) })) }),
listShifts: async () => (await remote<any[]>("/api/merchant/v1/shifts")).map((s) => ({ ...s, id: Number(s.id), status: s.status === "open" || s.status === "OPEN" ? "open" : "closed" })),
// queue（排队叫号）
listQueue: async (status?: string) => remote<any[]>(`/api/merchant/v1/queue?status=${encodeURIComponent(status || "")}`),
queueSummary:()=>remote<{waiting_count:number;waiting_people:number;called_no:string|null}>(P+'/queue/summary'),
takeQueue: async (p: {
    customer_name?: string;
    people?: number;
    phone?: string;
}, operatorId: number) => {
    const result = await remote<any>("/api/merchant/v1/queue/take", { method: "POST", body: JSON.stringify(p) });
    if (isRemoteFailure(result))
        return result;
    return { ok: true as const, queue: result };
},
callQueue: async (id: number, operatorId: number,version:number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/queue/${id}/call`, { method: "POST", body: JSON.stringify({version}) }),
doneQueue: async (id: number, operatorId: number,version:number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/queue/${id}/done`, { method: "POST", body: JSON.stringify({version}) }),
cancelQueue: async (id: number, operatorId: number,version:number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/queue/${id}/cancel`, { method: "POST", body: JSON.stringify({version}) }),
// coupons（优惠券）
listCoupons: async (p?: {
    member_id?: number;
    status?: string;
}) => remote<any[]>(`/api/merchant/v1/coupons?member_id=${p?.member_id || ""}&status=${p?.status || ""}`),
issueCoupon: async (p: {
    member_id?: number | null;
    name: string;
    type?: string;
    value: number;
    min_amount?: number;
    expire_at?: string | null;
}, operatorId: number) => remote<{
    ok: boolean;
    msg?: string;
}>("/api/merchant/v1/coupons", { method: "POST", body: JSON.stringify(p) }),
useCoupon: async (p: {
    order_id: number;
    version?: number;
    coupon_id: number;
}, operatorId: number) => {
    const res = await remote<{
        applied_discount: number;
    } & Order>(`/api/merchant/v1/coupons/${p.coupon_id}/use`, { method: "POST", body: JSON.stringify({ order_id: p.order_id, version: p.version??expectedVersion(p.order_id) }) });
    if (isRemoteFailure(res))
        return res;
    return { ok: true as const, discount: res.applied_discount, order: await orderFromMutation(res, p.order_id) };
},
// reports
dailyReport: (start?: string, end?: string) => remote(`/api/merchant/v1/reports/daily?start_date=${encodeURIComponent(start || "")}&end_date=${encodeURIComponent(end || "")}`),
technicianReport: (start?: string, end?: string) => remote(`/api/merchant/v1/reports/technicians?start_date=${encodeURIComponent(start || "")}&end_date=${encodeURIComponent(end || "")}`),
memberReport: (start?: string, end?: string) => remote(`/api/merchant/v1/reports/members?start_date=${encodeURIComponent(start || "")}&end_date=${encodeURIComponent(end || "")}`),
wakeSleepMembers: (p: {
    name?: string;
    value: number;
    min_amount?: number;
    expire_days?: number;
    threshold_days?: number;
}, key?:string) => remote<any>("/api/merchant/v1/members/wake", { method: "POST", headers:key?{'Idempotency-Key':key}:undefined, body: JSON.stringify(p) }),
flowReport: (start?: string, end?: string) => remote<any[]>(`/api/merchant/v1/reports/flow?start_date=${encodeURIComponent(start || "")}&end_date=${encodeURIComponent(end || "")}`),
monthlyReport: (month?: string) => remote(`/api/merchant/v1/reports/monthly?month=${encodeURIComponent(month || "")}`),
verificationReport: (start?: string, end?: string) => remote<any>(`/api/merchant/v1/reports/verifications?start_date=${encodeURIComponent(start || "")}&end_date=${encodeURIComponent(end || "")}`),
roomReport: (start?: string, end?: string) => remote<any>(`/api/merchant/v1/reports/rooms?start_date=${encodeURIComponent(start || "")}&end_date=${encodeURIComponent(end || "")}`),
cashierReport: (start?: string, end?: string) => remote<any>(`/api/merchant/v1/reports/cashiers?start_date=${encodeURIComponent(start || "")}&end_date=${encodeURIComponent(end || "")}`),
// settings & logs
getSettings: (): Promise<Record<string, string>> => remote<Record<string, string>>("/api/merchant/v1/settings"),
getCashierSettings: (): Promise<Record<string, string>> => remote<Record<string, string>>("/api/merchant/v1/settings/cashier"),
saveSettings: async(kv: Record<string, string>, _operatorId: number) => {const result=await remote<any>(P+'/settings',{method:'POST',body:JSON.stringify(kv)});if(isRemoteFailure(result))throw Error(result.msg);return result},
listLogs: (limit?: number) => remote(`/api/merchant/v1/audit-logs?limit=${limit || 200}`),
// Merchant-owned templates require explicit target stores and a reviewed preview.
listCatalogTemplates:(type:TemplateType)=>remote<MerchantTemplate[]>(P+'/catalog/templates?type='+type),
saveCatalogTemplate:(p:any)=>requireResult(remote<MerchantTemplate>(P+'/catalog/templates',{method:'POST',body:JSON.stringify(p)})),
deleteCatalogTemplate:(id:number,version:number,reason:string)=>requireResult(remote<MerchantTemplate>(P+'/catalog/templates/'+id,{method:'DELETE',body:JSON.stringify({version,reason})})),
previewCatalog:(p:{template_id:number;version:number;store_ids:number[]})=>requireResult(remote<TemplatePreview>(P+'/catalog/preview',{method:'POST',body:JSON.stringify(p)})),
distributeCatalog:(p:{template_id:number;version:number;store_ids:number[];preview_hash:string})=>requireResult(remote<TemplatePreview&{distributed:number;stores:number}>(P+'/catalog/distribute',{method:'POST',body:JSON.stringify(p)})),
listCatalogDistribution:(templateId:number)=>remote<any[]>(P+'/catalog/distribution?template_id='+templateId),
listCouponProfiles:()=>remote<any[]>(P+'/coupon-profiles'),
issueCouponProfile:(id:number,member_id:number)=>requireResult(remote<any>(P+'/coupon-profiles/'+id+'/issue',{method:'POST',body:JSON.stringify({member_id})})),
listStores: () => remote<any[]>("/api/merchant/v1/stores"),
saveStore: async (p: {
    code: string;
    name: string;
    short_name?: string;
    point_clock_business_type?: 'BATH' | 'FOOT' | null;
}): Promise<{
    ok: boolean;
    msg?: string;
    id: number;
}> => {
    const result = await remote<{
        id: number;
    }>("/api/merchant/v1/stores", { method: "POST", body: JSON.stringify(p) });
    return { ok: true as const, ...result };
},
updateStore: (id: number, p: {
    name?: string;
    short_name?: string;
    point_clock_business_type?: 'BATH' | 'FOOT' | null;
    status?: number;
}) => remote(`/api/merchant/v1/stores/${id}`, { method: "PUT", body: JSON.stringify(p) }),
maintenanceSummary: () => remote<MaintenanceSummary>("/api/merchant/v1/maintenance/summary"),
maintenanceLogs: (query: Record<string, string>) => remote<LogPage>(`/api/merchant/v1/maintenance/logs?${new URLSearchParams(query)}`),
maintenanceDetail: (source: LogSource, id: number) => remote<MaintenanceLog>(`/api/merchant/v1/maintenance/logs/${source}/${id}`),
maintenanceExport: async (query: Record<string, string>) => {
    const result = await remote<(LogPage & {
        exported_at: string;
        privacy: string;
    }) | {
        ok: false;
        msg: string;
    }>(`/api/merchant/v1/maintenance/export?${new URLSearchParams(query)}`, { method: "POST" });
    if ("ok" in result && result.ok === false)
        throw new Error(result.msg);
    return result as LogPage & {
        exported_at: string;
        privacy: string;
    };
},
listPermissions: () => remote<{
    pages: Record<string, string[]>;
    actions: Record<string, string[]>;
}>("/api/merchant/v1/permissions"),
ownPermissions: () => remote<{
    pages: Record<string, string[]>;
    actions: Record<string, string[]>;
    operations: Record<string, string[]>;
}>("/api/merchant/v1/permissions/self"),
savePermissions: (p: {
    pages: Record<string, string[]>;
    actions: Record<string, string[]>;
}) => remote<{
    ok: boolean;
    msg?: string;
}>("/api/merchant/v1/permissions", { method: "PUT", body: JSON.stringify(p) }),
// 会员体系扩展（等级/充值方案/积分/分析/分群）
listMemberLevels: () => remote<any[]>("/api/merchant/v1/member-levels"),
saveMemberLevel: (p: any) => remote<{
    ok: boolean;
    msg?: string;
}>("/api/merchant/v1/member-levels", { method: "POST", body: JSON.stringify(p) }),
deleteMemberLevel: (id: number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/member-levels/${id}`, { method: "DELETE" }),
listRechargePlans: () => remote<any[]>("/api/merchant/v1/recharge-plans"),
saveRechargePlan: (p: any) => remote<{
    ok: boolean;
    msg?: string;
}>("/api/merchant/v1/recharge-plans", { method: "POST", body: JSON.stringify(p) }),
deleteRechargePlan: (id: number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/recharge-plans/${id}`, { method: "DELETE" }),
listMemberPoints: async(id:number)=>{const member=await remote<any>(P+'/members/'+id);return {points:member.points,list:await remote<any[]>(P+'/members/'+id+'/points')}},
exchangePoints: (memberId: number, points: number, remark?: string) => remote<{
    ok: boolean;
    msg?: string;
    points?: number;
}>(`/api/merchant/v1/members/${memberId}/points-exchange`, { method: "POST", body: JSON.stringify({ points, remark }) }),
memberAnalysis: () => remote<any>("/api/merchant/v1/members/analysis"),
memberSegments: () => remote<any>("/api/merchant/v1/members/segments"),
reverseRecharge: async(memberId:number,rechargeId?:number)=>{if(!rechargeId)throw Error('请先选择要冲销的充值流水');return remote<any>(P+'/members/'+memberId+'/reverse-recharge',{method:'POST',body:JSON.stringify({recharge_id:rechargeId,reason:await askReason('充值冲销原因')})})},
// 排钟 + 技师技能
technicianQueue: () => remote<any[]>("/api/merchant/v1/technicians/queue"),
technicianQueueHistory:()=>remote<any[]>(P+'/technicians/queue-history'),
technicianQueueOrder:()=>remote<{rows:any[];version:string}>(P+'/technicians/queue-order'),
saveTechnicianQueueOrder:(ids:number[],version:string,reason?:string)=>requireResult(remote(P+'/technicians/queue-order',{method:'POST',body:JSON.stringify({ids,version,reason})})),
setTechSkills: (techId: number, itemIds: number[]) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/technicians/${techId}/skills`, { method: "POST", body: JSON.stringify({ item_ids: itemIds }) }),
listTechSkills: () => remote<Record<string, number[]>>("/api/merchant/v1/technician-skills"),
getSnapshot: () => snapshot(),
// 手牌押金 / 酒水寄存 / 公告 / 订房提成 / 工资
setWristbandDeposit: (id: number, deposit: number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/wristbands/${id}/deposit`, { method: "POST", body: JSON.stringify({ deposit }) }),
listWineStorage: () => remote<any[]>("/api/merchant/v1/wine-storage"),
saveWineStorage: (p: any) => remote<{
    ok: boolean;
    msg?: string;
}>("/api/merchant/v1/wine-storage", { method: "POST", body: JSON.stringify(p) }),
deleteWineStorage: (id: number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/wine-storage/${id}`, { method: "DELETE" }),
listAnnouncements: () => remote<any[]>("/api/merchant/v1/announcements"),
saveAnnouncement: (p: any) => remote<{
    ok: boolean;
    msg?: string;
}>("/api/merchant/v1/announcements", { method: "POST", body: JSON.stringify(p) }),
deleteAnnouncement: (id: number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/announcements/${id}`, { method: "DELETE" }),
setReservationStaff: (id: number, staffId: number | null,version:number) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/reservations/${id}/staff`, { method: "POST", body: JSON.stringify({ staff_id: staffId,version }) }),
arriveAndOpen: (id: number,version:number) => remote<any>(`/api/merchant/v1/reservations/${id}/arrive-open`, { method: "POST", body: JSON.stringify({version}) }),
salaryReport: (month?: string) => remote<any>(`/api/merchant/v1/reports/salaries?month=${encodeURIComponent(month || "")}`),
analysisReport: (days?: number) => remote<any>(`/api/merchant/v1/reports/analysis?days=${days || 14}`),
growthReport: (start?: string, end?: string) => remote<any>(`/api/merchant/v1/reports/growth?start_date=${encodeURIComponent(start || "")}&end_date=${encodeURIComponent(end || "")}`),
executiveBrief: (date?: string) => remote<any>(`/api/merchant/v1/reports/executive-brief?date=${encodeURIComponent(date || "")}`),
patrol: (p:{room_id:number;status:'normal'|'issue';remark?:string;expected_id:number},key:string)=>remote<any>("/api/merchant/v1/patrol",{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(p)}),
patrols: (date?: string) => remote<any>(`/api/merchant/v1/patrols?date=${encodeURIComponent(date || "")}`),
refundDeposit: async(id:number,version=expectedVersion(id))=>mutateOrder(id,'refund-deposit',{version,reason:await askReason('退还押金原因')}),
// 第一阶段：耗材配方、审批、经营风控
listServiceConsumables: (serviceId: number) => remote<any[]>(`/api/merchant/v1/service-consumables/${serviceId}`),
saveServiceConsumables: (serviceId:number,items:{product_item_id:number;qty:number}[],_reason?:string)=>remote<any>(P+'/service-consumables/'+serviceId,{method:'PUT',body:JSON.stringify({items})}),
listApprovals: (status = "pending") => remote<any[]>(`/api/merchant/v1/approvals?status=${encodeURIComponent(status)}`),
listChannelConnections: () => remote<any[]>("/api/merchant/v1/integrations/connections"),
saveChannelConnection: async (channel: string, input: any) => {const result=await remote<any>(`/api/merchant/v1/integrations/connections/${channel}`, { method: "PUT", body: JSON.stringify(input) });if(isRemoteFailure(result))throw Error(result.msg);return result},
listChannelOrders: () => remote<any[]>("/api/merchant/v1/integrations/orders"),
listBookingPaymentProviders: () => remote<any[]>("/api/merchant/v1/payments/providers"),
saveBookingPaymentProvider: (provider: "wechat" | "alipay", input: any) => requireResult(remote<any>(`/api/merchant/v1/payments/providers/${provider}`, { method: "PUT", body: JSON.stringify(input) })),
listBookingPayments: (status?: string) => remote<any[]>(`/api/merchant/v1/payments/booking/orders?status=${encodeURIComponent(status || "")}`),
listBookingRefunds: (status?: string) => remote<any[]>(`/api/merchant/v1/payments/booking/refunds?status=${encodeURIComponent(status || "")}`),
bookingReconciliation: (date?: string) => remote<any>(`/api/merchant/v1/payments/booking/reconciliation?date=${encodeURIComponent(date || "")}`),
listPricingRules: () => remote<any[]>("/api/merchant/v1/pricing-rules"),
savePricingRule: (input: any) => {
 const fields=['id','version','name','priority','weekdays','start_time','end_time','effective_from','effective_to','room_type','technician_level','member_level','adjustment_type','adjustment_value','stack_mode','enabled','reason'];
 const body=Object.fromEntries(fields.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));body.item_id=input.item_id||null;
 return requireResult(remote<any>("/api/merchant/v1/pricing-rules", { method: "POST", body: JSON.stringify(body) }));
},
deletePricingRule: (id: number, version: number, reason?: string) => requireResult(remote<{
    ok: boolean;
}>(`/api/merchant/v1/pricing-rules/${id}`, { method: "DELETE", body: JSON.stringify({ version, reason }) })),
previewPrice: (input: any) => requireResult(remote<any>("/api/merchant/v1/pricing-rules/preview", { method: "POST", body: JSON.stringify(input) })),
reviewApproval: (id: number, status: "approved" | "rejected", review_note?: string) => remote<{
    ok: boolean;
    msg?: string;
}>(`/api/merchant/v1/approvals/${id}/review`, { method: "POST", body: JSON.stringify({ status, review_note }) }),
listAuditEvents: async(limit=200)=>(await remote<any>(P+'/audit-events?limit='+limit)).items,
profitReport: (date?: string) => remote<any>(`/api/merchant/v1/reports/profit?date=${encodeURIComponent(date || "")}`),
alerts: (date?: string) => remote<any>(`/api/merchant/v1/alerts?date=${encodeURIComponent(date || "")}`),
payrollSnapshot: (month: string) => remote<any>(`/api/merchant/v1/payroll/${encodeURIComponent(month)}`),
lockPayroll: (month: string, reason?: string) => remote<any>(`/api/merchant/v1/payroll/${encodeURIComponent(month)}/lock`, { method: "POST", body: JSON.stringify({ reason }) })
}

