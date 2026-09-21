import {z} from 'zod';
export * from './permissions.js';
export * from './announcer.js';
export * from './templates.js';
export * from './hardware-readiness.js';
export * from './inventory.js';
export * from './member-assets.js';
export * from './marketing.js';
export const protocolVersion=1;
export const MerchantCode=z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,31}$/);
export const AccountName=z.string().trim().toLowerCase().min(3).max(200);
export const Password=z.string().min(8,'密码需为 8–20 位字符').max(20,'密码需为 8–20 位字符');
export const MerchantLogin=z.object({merchant_code:MerchantCode,username:AccountName,password:z.string().min(1).max(128)}).strict();
export const MemberMode=z.enum(['store','merchant']);
export const MerchantCreate=z.object({code:MerchantCode,name:z.string().trim().min(1).max(100),member_mode:MemberMode.default('store')}).strict();
export const StoreRole=z.enum(['manager','floor','technician']);
export type StoreRole=z.infer<typeof StoreRole>;
export type AuthRealm='platform'|'merchant'|'support';
export interface SessionBootstrap{realm:AuthRealm;token:string;merchant?:{id:string;code:string;name:string;member_mode:'store'|'merchant';status:'active'|'suspended'};user:{id:number;username:string;name:string;role:string};stores:Array<{id:number;code:string;name:string;role:string}>;current_store_id:number|null}
