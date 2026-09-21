import {z} from 'zod';

const id=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// Decimal precision is checked from the canonical decimal string, without a
// floating-point multiplication such as 1.001 * 1000.
const precision=(places:number)=>(v:number)=>Number.isInteger(v)||new RegExp(`^\\d+\\.\\d{1,${places}}$`).test(String(v));
export const StockQuantity=z.number().finite().positive().max(1e9).refine(precision(3),'数量最多三位小数');
const cost=z.number().finite().min(0).max(999999999999.99).refine(precision(2),'金额最多两位小数');
const reason=z.string().trim().min(1,'请填写操作原因').max(500);
export const PurchaseCreate=z.object({supplier_id:id.optional(),remark:z.string().trim().max(500).default(''),items:z.array(z.object({item_id:id,ordered_qty:StockQuantity,unit_cost:cost}).strict()).min(1).max(500)}).strict().refine(v=>new Set(v.items.map(i=>i.item_id)).size===v.items.length,'采购商品不能重复');
export const PurchaseReceipt=z.object({version:id,mode:z.enum(['receive','return']).default('receive'),items:z.array(z.object({id,qty:StockQuantity}).strict()).min(1).max(500),reason}).strict().refine(v=>new Set(v.items.map(i=>i.id)).size===v.items.length,'收货明细不能重复');
export const PurchaseCancel=z.object({version:id,reason}).strict();
export const TransferCreate=z.object({from_store_id:id,to_store_id:id,remark:reason,items:z.array(z.object({item_id:id,target_item_id:id,qty:StockQuantity}).strict()).min(1).max(200)}).strict().refine(v=>new Set(v.items.map(i=>i.item_id)).size===v.items.length&&new Set(v.items.map(i=>i.target_item_id)).size===v.items.length,'调出和调入商品均不能重复');
export type PurchaseCreate=z.input<typeof PurchaseCreate>;
export type PurchaseReceipt=z.input<typeof PurchaseReceipt>;
export type TransferCreate=z.input<typeof TransferCreate>;
export interface PurchaseLine{id:number;item_id:number;item_name:string;unit:string;ordered_qty:number;received_qty:number;returned_qty:number;unit_cost:number}
export interface PurchaseOrder{id:number;store_id:number;order_no:string;supplier_name:string|null;status:'draft'|'partial'|'received'|'cancelled';version:number;remark:string|null;ordered_at:string;items:PurchaseLine[]}
export interface TransferLine{id:number;item_id:number;target_item_id:number;item_name:string;target_item_name:string;unit:string;target_unit:string;qty:number}
export interface InventoryTransfer{id:number;from_store_id:number;to_store_id:number;from_store_name:string;to_store_name:string;transfer_no:string;status:'draft'|'dispatched'|'received'|'cancelled';remark:string;items:TransferLine[]}
export interface InventoryPage<T>{items:T[];next_cursor:number|null}
