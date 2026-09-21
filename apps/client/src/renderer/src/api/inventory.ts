import type {InventoryPage,InventoryTransfer,PurchaseOrder} from '@za-spa/contracts'
import {remote,isRemoteFailure} from './transport'

const prefix='/api/merchant/v1'
export interface StockProduct{id:number;name:string;unit:string;stock:number;cost:number;type?:string;active?:number}
export interface Supplier{id:number;name:string;phone:string|null;contact_name:string|null;active:number}
export type PurchaseSummary=Omit<PurchaseOrder,'items'>
export type TransferSummary=Omit<InventoryTransfer,'items'>
export const supplyApi={
 purchases:(before?:number)=>remote<InventoryPage<PurchaseSummary>>(prefix+'/purchase-orders'+(before?'?before='+before:'')),
 purchase:(id:number)=>remote<PurchaseOrder>(prefix+'/purchase-orders/'+id),
 transfers:(before?:number)=>remote<InventoryPage<TransferSummary>>(prefix+'/inventory-transfers'+(before?'?before='+before:'')),
 transfer:(id:number)=>remote<InventoryTransfer>(prefix+'/inventory-transfers/'+id),
 suppliers:()=>remote<Supplier[]>(prefix+'/suppliers'),
 products:()=>remote<StockProduct[]>(prefix+'/items').then(rows=>rows.filter(i=>i.type==='product'&&i.active===1&&i.stock>=0)),
 destinations:()=>remote<Array<{id:number;name:string}>>(prefix+'/inventory-transfers/destinations'),
 targetProducts:(id:number)=>remote<StockProduct[]>(prefix+'/inventory-transfers/catalog/'+id),
 async mutate<T>(path:string,body:unknown,key:string):Promise<T>{
  const result=await remote<T>(prefix+path,{method:'POST',body:JSON.stringify(body),headers:{'Idempotency-Key':key}})
  if(isRemoteFailure(result))throw Object.assign(Error(result.msg),{code:result.code})
  return result
 }
}
