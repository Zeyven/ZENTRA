import {harness,succeeded} from '../tests/helpers.js';
import {inTenant,tenantQuery,platformPool} from '../apps/server/src/db/pools.js';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const python=process.env.SAAS_OPERATOR_PYTHON??'python';
function remote(action:string){const p=spawnSync(python,['scripts/test-recovery-command.py',action],{encoding:'utf8',timeout:900000});assert.equal(p.status,0,p.stderr+p.stdout);return p.stdout;}
const h=await harness();try{
 const a=await h.onboard(),b=await h.onboard();const member=succeeded(await h.api(a.token,a.stores[0].id,'/wristbands','POST',{code:'RESTORE001'}));
 const admin=succeeded(await h.call('/api/platform/v1/merchants/'+a.merchant.id+'/admin-session','POST',{},h.platformToken));
 const output=remote('backup');const created=output.split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s)).find(r=>r.event==='backup.created');assert(created);
 succeeded(await h.api(a.token,a.stores[0].id,'/wristbands/'+member.id,'DELETE'));
 const other=succeeded(await h.api(b.token,b.stores[0].id,'/wristbands','POST',{code:'OTHER-AFTER-BACKUP'}));
 succeeded(await h.api(admin.token,undefined,'/users/'+a.user.id,'PATCH',{active:0}));
 remote('worker');
 const path='/api/platform/v1/merchants/'+a.merchant.id+'/recovery';const call=(method:string,body?:any)=>h.call(path,method,body,h.platformToken);
 succeeded(await h.call('/api/platform/v1/merchants/'+b.merchant.id+'/recovery','GET',undefined,h.platformToken));
 assert.equal((await h.call('/api/platform/v1/merchants/'+b.merchant.id+'/recovery','GET',undefined,b.token)).status,401);
 const pbody={request_id:randomUUID(),kind:'preview',archive_id:created.file,reason:'验证已删除手牌恢复'};const pre=succeeded(await call('POST',pbody));assert.equal(succeeded(await call('POST',pbody)).id,pre.id);
 remote('worker');let state=succeeded(await call('GET'));let preview=state.jobs.find((j:any)=>j.id===pre.id);assert.equal(preview.status,'succeeded',JSON.stringify(preview));assert.equal(preview.result.counts.wristbands,1);
 const user=await inTenant(a.merchant.id,()=>tenantQuery('SELECT password,active FROM merchant_users WHERE id=$1',[a.user.id]));
 const auditBefore=(await platformPool.query("SELECT count(*)::int n FROM platform_audit WHERE merchant_id=$1 AND detail ? 'merchant_audit_id'",[a.merchant.id])).rows[0].n;
 const restore=succeeded(await call('POST',{request_id:randomUUID(),kind:'restore',archive_id:created.file,preview_id:pre.id,reason:'恢复已删除手牌测试',confirmation_code:a.merchant.code,current_password:'Test-Secret-867!'}));
 remote('worker');
 const restored=await inTenant(a.merchant.id,()=>tenantQuery('SELECT code FROM wristbands WHERE id=$1',[member.id]));assert.equal(restored.rows[0].code,'RESTORE001');
 const userAfter=await inTenant(a.merchant.id,()=>tenantQuery('SELECT password,active FROM merchant_users WHERE id=$1',[a.user.id]));assert.equal(user.rows[0].password,userAfter.rows[0].password);
 assert.equal((await platformPool.query("SELECT count(*)::int n FROM platform_audit WHERE merchant_id=$1 AND detail ? 'merchant_audit_id'",[a.merchant.id])).rows[0].n,auditBefore);
 succeeded(await call('GET'));assert.equal(userAfter.rows[0].active,0);
 const final=succeeded(await h.call(path+'/status','GET',undefined,h.platformToken));assert.equal(final.jobs.find((j:any)=>j.id===restore.id).status,'succeeded');
 const otherAfter=await inTenant(b.merchant.id,()=>tenantQuery('SELECT code FROM wristbands WHERE id=$1',[other.id]));assert.equal(otherAfter.rows[0].code,'OTHER-AFTER-BACKUP');
 const expired=succeeded(await call('POST',{request_id:randomUUID(),kind:'preview',archive_id:created.file,reason:'平台退出后禁止执行'}));
 succeeded(await h.call('/api/platform/v1/auth/logout','POST',{},h.platformToken));remote('worker');
 assert.equal((await platformPool.query('SELECT status FROM platform_recovery_jobs WHERE id=$1',[expired.id])).rows[0].status,'failed');
 console.log(JSON.stringify({backup_preview:true,deleted_wristband_restored:true,credentials_preserved:true,without_owner_grant:true,inactive_owner_preserved:true,revoked_platform_job_denied:true,idempotent_enqueue:true,merchant_credentials_denied:true,other_merchant_data_preserved:true,job_id:restore.id}));
}finally{await h.stop()}
