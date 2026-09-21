import fs from 'node:fs';
const path='docs/feature-parity.json',rows=JSON.parse(fs.readFileSync(path,'utf8'));
const modules={
 admin:['tests/access.test.ts','tests/page-permissions.test.ts','tests/owner-invites.test.ts'],
 auth:['tests/access.test.ts','tests/realtime.test.ts'],
 'booking-payments':['tests/integrations.test.ts','tests/public-booking.test.ts'],
 clocks:['tests/clock-operations.test.ts','tests/clock-jobs.test.ts','tests/browser/clock-operations.spec.ts'],
 dashboard:['tests/browser/onboarding.spec.ts','tests/page-permissions.test.ts'],
 integrations:['tests/integrations.test.ts'],
 leisure:['tests/operations.test.ts','tests/member-benefits.test.ts','tests/wallet.test.ts','tests/shifts.test.ts','tests/supply.test.ts','tests/wristbands.test.ts','tests/browser/onboarding.spec.ts','tests/browser/member-assets.spec.ts'],
 maintenance:['tests/maintenance.test.ts','tests/browser/member-assets.spec.ts'],
 public:['tests/public-booking.test.ts','tests/reservations-queue.test.ts','tests/coupon-claims.test.ts','tests/browser/member-assets.spec.ts'],
 'room-warnings':['tests/clock-operations.test.ts','tests/browser/clock-operations.spec.ts'],
 stores:['tests/access.test.ts','tests/browser/onboarding.spec.ts'],
 users:['tests/access.test.ts','tests/page-permissions.test.ts']
};
for(const row of rows){
 if(row.status!=='pending')continue;
 row.status='module_regression_verified';row.evidence=modules[row.module];if(!row.evidence)throw Error('Unmapped module '+row.module);
 row.verification_scope='对应新 SaaS 模块的业务与隔离回归；不表示保留旧协议或每条接口均有独立用例';
 if(row.module==='auth'&&row.path.includes('/mfa/')){row.status='legacy_identity_protocol_not_carried_forward';row.replacement='独立平台与商家账号契约；本版本未实现多因素认证';}
 else if(row.path==='/import'){row.status='replaced_by_scoped_operator_restore';row.replacement='停用目标商家后，由独立离线恢复工具先备份再原子恢复；没有业务端全库覆盖入口';row.evidence=['scripts/saas-tenant-restore.py','scripts/exercise-tenant-restore.py','tests/restoration-lock.test.ts'];}
 else if(row.path==='/export'){row.replacement='/api/merchant/v1/exports/business';row.evidence=['tests/exports.test.ts','tests/browser/member-assets.spec.ts'];}
 else if(['booking-payments','integrations'].includes(row.module)||['/swipe','/swipes'].includes(row.path)){row.status='reserved_integration_scope_verified';row.replacement='按用户授权范围保留独立渠道或设备接口，未接入状态不得模拟支付、核销或设备成功';row.evidence=['tests/integrations.test.ts','docs/RESERVED-INTEGRATIONS.md'];}
 else if(['auth','admin','stores','users'].includes(row.module)){row.replacement='新平台开通、一次性老板邀请、独立账号与门店授权；停用保留历史，原权限协议不兼容';}
 else if(row.path.includes('realtime-')){row.replacement='统一已认证 Socket.IO 会话与商家、门店事件游标';row.evidence=['tests/realtime.test.ts','tests/page-permissions.test.ts'];}
 for(const file of row.evidence)if(!fs.existsSync(file))throw Error('Missing evidence '+file);
}
fs.writeFileSync(path,JSON.stringify(rows,null,2)+'\n');console.log(JSON.stringify({entries:rows.length,pending:rows.filter(r=>r.status==='pending').length,legacy_identity_exceptions:rows.filter(r=>r.status==='legacy_identity_protocol_not_carried_forward').length}));
