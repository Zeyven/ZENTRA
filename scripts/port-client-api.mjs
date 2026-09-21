import fs from 'node:fs';
import ts from 'typescript';
const file='apps/client/src/renderer/src/api/index.ts',original=fs.readFileSync(file,'utf8');
if(original.includes("from './transport'"))throw Error('Client API already ported; edit the resulting source directly');
const source=ts.createSourceFile(file,original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
const initializer=source.statements.flatMap(s=>ts.isVariableStatement(s)?s.declarationList.declarations:[]).find(d=>d.name.getText(source)==='api').initializer;
const changePath=text=>text.replace(/^\/leisure(?=\/|$)/,'/api/merchant/v1').replace(/^\/api\/v1(?=\/|$)/,'/api/merchant/v1').replace(/^\/api\/(clocks|integrations|payments)(?=\/|$)/,'/api/merchant/v1/$1');
const transformed=ts.transform(initializer,[context=>root=>{
 const visit=node=>{
  if(ts.isConditionalExpression(node)&&node.condition.getText(source)==='useRemote')return ts.visitNode(node.whenTrue,visit);
  if(ts.isIfStatement(node)&&node.expression.getText(source)==='!useRemote')return undefined;
  if(ts.isStringLiteral(node))return ts.factory.createStringLiteral(changePath(node.text));
  if(ts.isNoSubstitutionTemplateLiteral(node))return ts.factory.createNoSubstitutionTemplateLiteral(changePath(node.text));
  if(ts.isTemplateHead(node))return ts.factory.createTemplateHead(changePath(node.text));
  return ts.visitEachChild(node,visit,context);
 };return ts.visitNode(root,visit);
}]).transformed[0];
const properties=new Map(transformed.properties.map(p=>[p.name.getText(source),printer.printNode(ts.EmitHint.Unspecified,p,source)]));
const overrides={
 login:`async (merchant_code:string,username:string,password:string):Promise<any>=>{const result=await remote<any>(P+'/auth/login',{method:'POST',body:JSON.stringify({merchant_code,username,password})});if(isRemoteFailure(result))return result;useAuth.getState().setBootstrap(result);return {ok:true,user:useAuth.getState().user,bootstrap:result}}`,
 selectStore:`async(storeId:number)=>{const result=await remote<any>(P+'/session',{headers:{'X-Store-ID':String(storeId)}});useAuth.getState().setBootstrap(result);return result}`,
 refreshSession:`async()=>{const result=await remote<any>(P+'/session');useAuth.getState().setBootstrap(result);return result}`,
 logoutRemote:`async()=>{try{await remote(P+'/auth/logout',{method:'POST',body:'{}'})}finally{useAuth.getState().clearSession()}}`,
 changePassword:`async(_id:number,current_password:string,new_password:string)=>{const result=await remote<any>(P+'/auth/password',{method:'POST',body:JSON.stringify({current_password,new_password})});if(!isRemoteFailure(result))useAuth.getState().clearSession();return result}`,
 subscribeRealtime:`(onChange:(event?:any)=>void,_all=false)=>subscribeRealtime(onChange)`,
 listCategories:`()=>remote<Category[]>(P+'/categories')`,
 listItems:`()=>remote<Item[]>(P+'/items')`,
 listOrders:`(status?:string,date?:string)=>remote<Order[]>(P+'/orders'+query({status,date}))`,
 openOrder:`async(p:any,_operatorId:number):Promise<any>=>{const result=await remote<any>(P+'/sessions',{method:'POST',body:JSON.stringify({resource_id:p.room_id,guest_name:p.customer_name||'',customer_id:p.member_id||null,...(p.wristband_no?{wristband_no:p.wristband_no}:{}),...(p.deposit!==undefined?{deposit:p.deposit}:{})})});if(isRemoteFailure(result))return result;const order=checkedOrder(result.order,result.id);return {ok:true,order,order_no:order.order_no,order_id:order.id}}`,
 addItems:`async(p:any,_operatorId:number)=>{let order:Order|undefined;let version=p.version??expectedVersion(p.order_id);for(const item of p.items){const result=await remote<any>(P+'/sessions/'+p.order_id+'/items',{method:'POST',body:JSON.stringify({version,catalog_id:item.item_id,quantity:Number(item.quantity),technician_id:item.technician_id||null,service_type:item.service_type||'轮钟'})});if(isRemoteFailure(result))return result;order=checkedOrder(result.order,p.order_id);version=order.version!}return {ok:true,order}}`,
 settle:`async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'checkout',{version:p.version??expectedVersion(p.order_id),payments:p.payments},p.idempotency_key)`,
 refundItem:`async(p:any,_operatorId:number)=>mutateItem(p,'refund',{reason:await askReason('退单原因',p.reason)})`,
 giftItem:`async(p:any,_operatorId:number)=>mutateItem(p,'gift',{reason:await askReason('赠送原因',p.reason)})`,
 changePrice:`async(p:any,_operatorId:number)=>mutateItem(p,'price',{price:p.price,reason:await askReason('改价原因',p.reason)})`,
 addTime:`async(p:any,_operatorId:number)=>mutateItem(p,'add-time',{minutes:p.minutes})`,
 changeTechnician:`async(p:any,_operatorId:number)=>mutateItem(p,'technician',{technician_id:p.technician_id})`,
 endService:`async(p:any,_operatorId:number)=>mutateItem(p,'end',{reason:await askReason('结束服务原因',p.reason)})`,
 bindMember:`async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'bind-member',{version:p.version??expectedVersion(p.order_id),member_id:p.member_id??null,customer_name:p.customer_name})`,
 applyDiscount:`async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'discount',{version:p.version??expectedVersion(p.order_id),discount:p.discount,reason:await askReason('优惠原因',p.reason)})`,
 changeRoom:`async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'change-room',{version:p.version??expectedVersion(p.order_id),room_id:p.room_id})`,
 reverseSettle:`async(id:number,_operatorId:number,version=expectedVersion(id))=>mutateOrder(id,'reverse-checkout',{version,reason:await askReason('反结账原因')})`,
 cancelOrder:`async(id:number,_operatorId:number,version=expectedVersion(id))=>mutateOrder(id,'cancel',{version,reason:await askReason('取消订单原因')})`,
 suspendOrder:`async(id:number,_operatorId:number,version=expectedVersion(id))=>mutateOrder(id,'suspend',{version})`,
 resumeOrder:`async(p:any,_operatorId:number)=>mutateOrder(p.order_id,'resume',{version:p.version??expectedVersion(p.order_id),...(p.room_id?{room_id:p.room_id}:{})})`,
 refundDeposit:`async(id:number,version=expectedVersion(id))=>mutateOrder(id,'refund-deposit',{version,reason:await askReason('退还押金原因')})`,
 saveItem:`(item:any,_operatorId:number)=>remote(P+'/items',{method:'POST',body:JSON.stringify(pick(item,['id','name','category_id','type','price','duration','commission','stock','low_stock_threshold','cost','unit','sold_out','is_primary']))})`,
 saveRoom:`(room:any,_operatorId:number)=>remote(P+'/rooms',{method:'POST',body:JSON.stringify(pick(room,['id','room_no','room_name','room_type','capacity','sort_order']))})`,
 saveTechnician:`(tech:any,_operatorId:number)=>remote(P+'/technicians',{method:'POST',body:JSON.stringify(pick(tech,['id','name','code','phone','level','base_salary','commission_rate','wheel_rate','dianzhong_rate','half_rate','dianzhong_bonus','add_time_rate']))})`,
 rechargeMember:`(p:any,_operatorId:number)=>remote<any>(P+'/members/recharge',{method:'POST',...(p.idempotency_key?{headers:{'Idempotency-Key':p.idempotency_key}}:{}),body:JSON.stringify({customer_id:p.member_id,amount:Number(p.amount),gift_amount:Number(p.bonus||0),times:p.times||0,...(p.plan_id?{plan_id:p.plan_id}:{})})})`,
 setMemberStatus:`(p:any,_operatorId:number)=>remote<any>(P+'/members/'+p.member_id+'/status',{method:'POST',body:JSON.stringify({status:p.status==='active'?'active':'frozen'})})`,
 reverseRecharge:`async(memberId:number,rechargeId?:number)=>{if(!rechargeId)throw Error('请先选择要冲销的充值流水');return remote<any>(P+'/members/'+memberId+'/reverse-recharge',{method:'POST',body:JSON.stringify({recharge_id:rechargeId,reason:await askReason('充值冲销原因')})})}`,
 listAuditEvents:`async(limit=200)=>(await remote<any>(P+'/audit-events?limit='+limit)).items`,
 saveServiceConsumables:`(serviceId:number,items:{product_item_id:number;qty:number}[],_reason?:string)=>remote<any>(P+'/service-consumables/'+serviceId,{method:'PUT',body:JSON.stringify({items})})`,
 listMemberPoints:`async(id:number)=>{const member=await remote<any>(P+'/members/'+id);return {points:member.points,list:await remote<any[]>(P+'/members/'+id+'/points')}}`,
 addWristbands:`async(codes:string[],_operatorId:number)=>{for(const code of codes){const result=await remote<any>(P+'/wristbands',{method:'POST',body:JSON.stringify({code})});if(isRemoteFailure(result))return result}return {ok:true}}`
};
for(const [name,value] of Object.entries(overrides))properties.set(name,name+': '+value);
const mapRoom=source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name.text==='mapRoom').getText(source);
const output=`import type {Category,DataSourceMode,Item,Member,Order,Reservation,Room,SessionBootstrap,Shift,Technician,User,Wristband} from '../types'
import {useAuth} from '../store/auth'
import {useRealtime} from '../store/realtime'
import {uuid} from '../utils/uuid'
import type {LogPage,LogSource,MaintenanceLog,MaintenanceSummary} from '../types/maintenance'
import {remote,isRemoteFailure,subscribeRealtime,expectedVersion,rememberOrder} from './transport'
import {askReason} from '../components/ReasonDialog'
export {getServerUrl,setServerUrl} from './transport'
export const hasLocalBridge=()=>false
const P='/api/merchant/v1'
const snapshot=()=>remote<any>(P+'/snapshot')
const query=(values:Record<string,string|undefined>)=>{const params=new URLSearchParams(Object.entries(values).filter(([,v])=>!!v) as [string,string][]);return params.size?'?'+params:''}
const pick=(value:any,keys:string[])=>Object.fromEntries(keys.filter(key=>value[key]!==undefined&&!(key==='id'&&!value[key])).map(key=>[key,value[key]]))
${mapRoom}
async function remoteOrder(id:number){return checkedOrder(await remote(P+'/orders/'+id),id)}
function checkedOrder(order:any,id:number):Order{if(!order||order.id!==id||!Array.isArray(order.items)||!['open','suspended','closed','cancelled'].includes(order.status)||!['subtotal','discount','payable','paid'].every(key=>Number.isFinite(order[key])))throw Error('订单响应无效，请核对记录，勿重复提交');return rememberOrder(order)}
async function orderFromMutation(result:any,id:number){return checkedOrder(result?.order,id)}
async function mutateOrder(id:number,action:string,body:any,key?:string){const result=await remote<any>(P+'/sessions/'+id+'/'+action,{method:'POST',...(key?{headers:{'Idempotency-Key':key}}:{}),body:JSON.stringify(body)});if(isRemoteFailure(result))return result;return {ok:true,order:checkedOrder(result.order,id)}}
async function mutateItem(p:any,action:string,body:any){const result=await remote<any>(P+'/session-items/'+p.item_id+'/'+action,{method:'POST',body:JSON.stringify({...body,version:p.version??expectedVersion(p.order_id)})});if(isRemoteFailure(result))return result;return {ok:true,order:checkedOrder(result.order,p.order_id)}}
export const api={\n${[...properties.values()].join(',\n')}\n}
`;
fs.writeFileSync(file,output);
const panel='apps/client/src/renderer/src/components/CashierPanel.tsx';let text=fs.readFileSync(panel,'utf8');
text=text.replace(/order_id: order.id,/g,'order_id: order.id, version: order.version,').replaceAll('api.suspendOrder(order.id, user.id)','api.suspendOrder(order.id, user.id, order.version)').replaceAll('api.reverseSettle(order.id, user.id)','api.reverseSettle(order.id, user.id, order.version)').replaceAll('api.refundDeposit(order.id)','api.refundDeposit(order.id, order.version)');fs.writeFileSync(panel,text);
console.log('Ported',properties.size,'client business methods; identity and transport are new SaaS implementations');
