import {z} from 'zod';
const amount=z.number().finite().min(-999999999999.99).max(999999999999.99).refine(v=>/^-?\d+(\.\d{1,2})?$/.test(String(v)),'金额最多两位小数');
const count=z.number().int().min(-1e9).max(1e9);
export const MemberAdjustment=z.object({version:z.number().int().positive(),principal:amount.default(0),bonus:amount.default(0),times:count.default(0),points:count.default(0),reason:z.string().trim().min(1,'请填写调整原因').max(500)}).strict().refine(v=>v.principal!==0||v.bonus!==0||v.times!==0||v.points!==0,'请填写需要调整的权益');
export interface MemberAssetAccount{id:number;name:string;balance:number;bonus_balance:number;times_balance:number;points:number;asset_version:number;status:string}
export interface MemberAssetOperation{id:number;store_id:number;store_name:string;type:string;principal:number;bonus:number;times:number;points:number;reason:string;funded_amount:number;payment_method:string|null;reversed_by:number|null;reversal_of:number|null;created_at:string}
export interface MemberAssetPage{member:MemberAssetAccount;items:MemberAssetOperation[];next_cursor:number|null}
