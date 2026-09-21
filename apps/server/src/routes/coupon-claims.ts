import {Router} from 'express';
import {z} from 'zod';
import {merchantRoute,audit,event} from '../access.js';
import {publicStore} from './public.js';
import {context,tenantQuery,platformPool} from '../db/pools.js';
import {Id,PositiveMoney,idempotent,storeObject} from '../business.js';
import {ensure} from '../errors.js';
import {randomToken,digest} from '../security.js';
import {lockMember} from '../services/wallet.js';
import {defaultActions,defaultPages} from '@za-spa/contracts';
export const couponClaimsRouter=Router(),publicCouponClaimsRouter=Router();
const read={store:true,roles:['manager'],support:'read' as const},write={store:true,roles:['manager'],write:true,action:'discount'};
const shape=z.object({id:Id.optional(),version:z.number().int().nonnegative(),name:z.string().trim().min(1).max(100),type:z.enum(['cash','discount']),value:PositiveMoney.refine(v=>v>0),min_amount:PositiveMoney,expire_days:z.number().int().min(1).max(365),active:z.boolean(),max_claims:z.number().int().min(1).max(1000000)}).strict().refine(v=>v.type!=='discount'||v.value<=1,'折扣须在 0 与 1 之间');
couponClaimsRouter.get('/coupon-campaigns',merchantRoute(read,async(_req,a)=>(await tenantQuery('SELECT * FROM coupon_campaigns WHERE store_id=$1 ORDER BY id DESC',[a.storeId])).rows));
couponClaimsRouter.post('/coupon-campaigns',merchantRoute(write,async(req,a)=>idempotent(req,'coupon-campaign.save',async()=>{
 const b=shape.parse(req.body),old=b.id?await storeObject('coupon_campaigns',b.id,a.storeId!,true):null;ensure((old?.version??0)===b.version,409,'VERSION_CONFLICT','领券活动已变化，请刷新核对');ensure(b.max_claims>=(old?.issued_count??0),409,'CLAIM_LIMIT','总量不能少于已经领取的数量');
 const values=[b.name,b.type,b.value,b.min_amount,b.expire_days,b.active,b.max_claims],row=old?(await tenantQuery('UPDATE coupon_campaigns SET name=$1,type=$2,value=$3,min_amount=$4,expire_days=$5,active=$6,max_claims=$7,version=version+1 WHERE id=$8 RETURNING *',[...values,old.id])).rows[0]:(await tenantQuery('INSERT INTO coupon_campaigns(name,type,value,min_amount,expire_days,active,max_claims,store_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[...values,a.storeId])).rows[0];await audit('coupon.campaign.saved',{before:old,after:row},'coupon_campaign',row.id);await event('coupon.changed',row.id);return row;
})));
couponClaimsRouter.post('/coupon-campaigns/:id/invite',merchantRoute(write,async(req,a)=>idempotent(req,'coupon-campaign.invite:'+req.params.id,async()=>{
 const b=z.object({member_id:Id,verification:z.literal('in_person'),reason:z.string().trim().min(1).max(300)}).strict().parse(req.body),campaign=await storeObject('coupon_campaigns',Id.parse(req.params.id),a.storeId!,true);ensure(campaign.active,409,'CAMPAIGN_INACTIVE','领券活动未启用');const member=await lockMember(b.member_id);ensure(!(await tenantQuery('SELECT 1 FROM coupons WHERE claim_campaign_id=$1 AND member_id=$2',[campaign.id,member.id])).rowCount,409,'ALREADY_CLAIMED','会员已经领取本活动优惠券');
 const token=randomToken(),row=(await tenantQuery(`INSERT INTO coupon_claim_invitations(store_id,campaign_id,member_id,token_hash,campaign_version,expires_at,issued_by) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes',$6)
 ON CONFLICT(merchant_id,campaign_id,member_id) DO UPDATE SET token_hash=excluded.token_hash,campaign_version=excluded.campaign_version,expires_at=excluded.expires_at,issued_by=excluded.issued_by,revoked_at=NULL RETURNING id,expires_at`,[a.storeId,campaign.id,member.id,digest(token),campaign.version,a.user.id])).rows[0];
 await audit('coupon.claim.authorized',{campaign_id:campaign.id,member_id:member.id,verification:'in_person',reason:b.reason},'coupon_claim_invitation',row.id);const store=a.stores.find(s=>s.id===a.storeId)!;return {...row,claim_url:`${process.env.PUBLIC_ORIGIN}/customer/${encodeURIComponent(a.merchant.code)}/${encodeURIComponent(store.code)}/coupons#claim=${token}`};
})));
const scope='/:merchantCode/:storeCode/coupons',bearer=(req:any)=>z.string().regex(/^Bearer [A-Za-z0-9_-]{43}$/).parse(req.headers.authorization).slice(7);
async function invitation(token:string){const row=(await tenantQuery('SELECT * FROM coupon_claim_invitations WHERE store_id=$1 AND token_hash=$2',[context().storeId,digest(token)])).rows[0];ensure(row,404,'CLAIM_INVITATION_REQUIRED','领券凭据无效，请到店核验会员身份后获取');return row}
async function issuerAuthorized(id:number){
 const user=(await tenantQuery('SELECT role,active,platform_user_id FROM merchant_users WHERE id=$1',[id])).rows[0];if(user?.active!==1)return false;if(user.role==='owner')return true;
 if(user.platform_user_id)return !!(await platformPool.query('SELECT 1 FROM platform_users WHERE id=$1 AND active=true',[user.platform_user_id])).rowCount;
 const grant=(await tenantQuery('SELECT role,pages,actions FROM staff_store_grants WHERE user_id=$1 AND store_id=$2',[id,context().storeId])).rows[0];if(grant?.role!=='manager'||(grant.pages&&!grant.pages.includes('members'))||(grant.actions&&!grant.actions.includes('discount')))return false;
 const permissions=(await tenantQuery('SELECT kind,perm_key,enabled FROM role_permissions WHERE store_id=$1 AND role=$2',[context().storeId,grant.role])).rows;
 const page=permissions.find(p=>p.kind==='page'&&p.perm_key==='members'),action=permissions.find(p=>p.kind==='action'&&p.perm_key==='discount');return (page?page.enabled===1:defaultPages.manager.includes('members'))&&(action?action.enabled===1:(grant.actions??defaultActions.manager).includes('discount'));
}
const couponView=(row:any)=>({id:row.id,name:row.name,type:row.type,value:row.value,min_amount:row.min_amount,expire_at:row.expire_at,status:row.status});
publicCouponClaimsRouter.post(scope+'/verify-phone',publicStore(true,async req=>{z.object({phone:z.string().regex(/^1\d{10}$/)}).strict().parse(req.body);ensure(false,409,'PHONE_VERIFICATION_NOT_CONNECTED','手机号验证服务尚未接入，请到店核验后获取领券链接')}));
publicCouponClaimsRouter.get(scope+'/center',publicStore(false,async(_req,store)=>({store:{name:store.name,available:store.available},verification:'staff_invite',phone_verification_available:false,items:(await tenantQuery('SELECT id,name,type,value,min_amount,expire_days,max_claims-issued_count AS remaining FROM coupon_campaigns WHERE store_id=$1 AND active=true ORDER BY id',[store.id])).rows})));
publicCouponClaimsRouter.get(scope+'/invitation',publicStore(false,async req=>{
 const row=await invitation(bearer(req));if(row.used_coupon_id)return {claimed:true,coupon:couponView(await storeObject('coupons',row.used_coupon_id,context().storeId!))};ensure(!row.revoked_at&&new Date(row.expires_at).getTime()>Date.now(),409,'CLAIM_INVITATION_EXPIRED','领券链接已过期，请门店重新核验');const campaign=await storeObject('coupon_campaigns',row.campaign_id,context().storeId!);return {claimed:false,campaign:{id:campaign.id,name:campaign.name,type:campaign.type,value:campaign.value,min_amount:campaign.min_amount,expire_days:campaign.expire_days},expires_at:row.expires_at};
}));
publicCouponClaimsRouter.post(scope+'/claim',publicStore(true,async req=>{
 const token=bearer(req),known=await invitation(token);z.object({}).strict().parse(req.body);
 return idempotent(req,'coupon.claim:'+known.id,async()=>{
  const campaign=await storeObject('coupon_campaigns',known.campaign_id,context().storeId!,true),row=(await tenantQuery('SELECT * FROM coupon_claim_invitations WHERE id=$1 AND token_hash=$2 FOR UPDATE',[known.id,digest(token)])).rows[0];ensure(row,404,'CLAIM_INVITATION_REQUIRED','领券凭据已经更换');
  if(row.used_coupon_id)return {claimed:true,coupon:couponView(await storeObject('coupons',row.used_coupon_id,context().storeId!))};ensure(!row.revoked_at&&new Date(row.expires_at).getTime()>Date.now(),409,'CLAIM_INVITATION_EXPIRED','领券链接已过期');ensure(campaign.active&&campaign.version===row.campaign_version,409,'CAMPAIGN_CHANGED','活动配置已变化，请门店重新核验');ensure(campaign.issued_count<campaign.max_claims,409,'CAMPAIGN_EXHAUSTED','本活动名额已领完');await lockMember(row.member_id);
  ensure(await issuerAuthorized(row.issued_by),403,'CLAIM_AUTHORIZATION_REVOKED','门店核验人员授权已撤销，请重新核验');
  const coupon=(await tenantQuery("INSERT INTO coupons(store_id,member_id,claim_campaign_id,name,type,value,min_amount,expire_at,remark) VALUES($1,$2,$3,$4,$5,$6,$7,now()+make_interval(days=>$8),'门店核验后自助领取') RETURNING *",[context().storeId,row.member_id,campaign.id,campaign.name,campaign.type,campaign.value,campaign.min_amount,campaign.expire_days])).rows[0];await tenantQuery('UPDATE coupon_claim_invitations SET used_coupon_id=$1 WHERE id=$2',[coupon.id,row.id]);await tenantQuery('UPDATE coupon_campaigns SET issued_count=issued_count+1 WHERE id=$1',[campaign.id]);await audit('coupon.claimed',{campaign_id:campaign.id,member_id:row.member_id},'coupon',coupon.id);await event('coupon.changed',coupon.id);return {claimed:true,coupon:couponView(coupon)};
 });
}));
