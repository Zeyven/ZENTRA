import {z} from 'zod';
const name=z.string().trim().min(1).max(100);
const amount=z.number().finite().min(0).max(999999999999.99).refine(v=>/^\d+(\.\d{1,2})?$/.test(String(v)),'金额最多两位小数');
const integer=z.number().int().min(0).max(1000000000);
export const TemplateType=z.enum(['item','member_level','recharge_plan','coupon']);
export type TemplateType=z.infer<typeof TemplateType>;
export const TemplateDefinition=z.discriminatedUnion('type',[
 z.object({type:z.literal('item'),payload:z.object({name,type:z.enum(['service','product']),price:amount.refine(v=>v>0,'售价必须大于 0'),duration:integer.default(0),commission:amount.default(0),cost:amount.default(0),unit:name.default('份'),low_stock_threshold:integer.default(10)}).strict()}).strict(),
 z.object({type:z.literal('member_level'),payload:z.object({name,min_consume:amount.default(0),discount:z.number().gt(0).lte(1),sort_order:integer.default(0)}).strict()}).strict(),
 z.object({type:z.literal('recharge_plan'),payload:z.object({name,amount:amount.refine(v=>v>0),gift_amount:amount.default(0),sort_order:integer.default(0)}).strict()}).strict(),
 z.object({type:z.literal('coupon'),payload:z.object({name,type:z.enum(['cash','discount']),value:amount.refine(v=>v>0),min_amount:amount.default(0),valid_days:z.number().int().min(1).max(3650)}).strict().refine(v=>v.type!=='discount'||v.value<=1,'折扣必须在 0 到 1 之间')}).strict()
]);
export type TemplateDefinition=z.infer<typeof TemplateDefinition>;
export interface MerchantTemplate{id:number;type:TemplateType;name:string;payload:TemplateDefinition['payload'];version:number;active:boolean}
export interface TemplatePreview{template:MerchantTemplate;preview_hash:string;targets:Array<{store_id:number;store_name:string;action:'create'|'update'|'unchanged';before:Record<string,unknown>|null;after:Record<string,unknown>}>}
