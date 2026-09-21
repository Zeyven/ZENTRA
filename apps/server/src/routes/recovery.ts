import {Router} from 'express';
import {z} from 'zod';
import {platformRoute} from '../access.js';
import {platformPool,platformTransaction} from '../db/pools.js';
import {ensure} from '../errors.js';
import {verifyPassword} from '../security.js';
export const recoveryRouter=Router();
// Operators may inspect their own submitted job outcome independently of merchant sessions. This endpoint never reads merchant business records or archives.
recoveryRouter.get('/merchants/:id/recovery/status',platformRoute(async(req,user)=>{
 const mid=z.uuid().parse(req.params.id);
 return {jobs:(await platformPool.query('SELECT id,kind,archive_id,status,result,error,created_at,finished_at FROM platform_recovery_jobs WHERE merchant_id=$1 AND platform_user_id=$2 ORDER BY created_at DESC LIMIT 20',[mid,user.id])).rows};
}));
async function authorized(c:any,mid:string){ensure((await c.query('SELECT 1 FROM merchants WHERE id=$1',[mid])).rowCount,404,'NOT_FOUND','商家不存在');}
recoveryRouter.get('/merchants/:id/recovery',platformRoute(async(req,user)=>{const mid=z.uuid().parse(req.params.id);await authorized(platformPool,mid);return {archives:(await platformPool.query('SELECT id,created_at,bytes,checked_at FROM platform_backup_archives WHERE available=true ORDER BY created_at DESC LIMIT 100')).rows,jobs:(await platformPool.query('SELECT id,kind,archive_id,status,result,error,created_at,finished_at FROM platform_recovery_jobs WHERE merchant_id=$1 AND platform_user_id=$2 ORDER BY created_at DESC LIMIT 20',[mid,user.id])).rows};}));
recoveryRouter.post('/merchants/:id/recovery',platformRoute(async(req,user,claims)=>{
 const mid=z.uuid().parse(req.params.id),b=z.object({request_id:z.uuid(),kind:z.enum(['preview','restore']),archive_id:z.string().regex(/^za_spa_saas(?:_test)?-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump$/),preview_id:z.uuid().optional(),reason:z.string().trim().min(2).max(500),confirmation_code:z.string().optional(),current_password:z.string().max(128).optional()}).strict().parse(req.body);
 return platformTransaction(async c=>{await authorized(c,mid);const existing=(await c.query('SELECT * FROM platform_recovery_jobs WHERE id=$1',[b.request_id])).rows[0];if(existing){ensure(existing.merchant_id===mid&&existing.platform_user_id===user.id&&existing.kind===b.kind&&existing.archive_id===b.archive_id&&existing.reason===b.reason&&existing.preview_id===(b.preview_id??null),409,'REQUEST_CONFLICT','请求编号已用于其他操作');return {id:existing.id,status:existing.status};}
 ensure((await c.query('SELECT 1 FROM platform_backup_archives WHERE id=$1 AND available=true',[b.archive_id])).rowCount,404,'ARCHIVE_UNAVAILABLE','备份尚未同步或已不可用');
 if(b.kind==='restore'){const m=(await c.query('SELECT code FROM merchants WHERE id=$1',[mid])).rows[0];ensure(m&&b.confirmation_code===m.code,400,'CONFIRMATION_REQUIRED','请输入完整商家编号确认恢复');const p=(await c.query('SELECT password FROM platform_users WHERE id=$1',[user.id])).rows[0];ensure(b.current_password&&await verifyPassword(b.current_password,p.password),403,'PASSWORD_INVALID','当前平台密码不正确');ensure((await c.query("SELECT 1 FROM platform_recovery_jobs WHERE id=$1 AND merchant_id=$2 AND platform_user_id=$3 AND archive_id=$4 AND kind='preview' AND status='succeeded' AND finished_at>now()-interval '30 minutes'",[b.preview_id??null,mid,user.id,b.archive_id])).rowCount,409,'PREVIEW_REQUIRED','请先完成该商家和备份的预检');}
 const row=(await c.query(`INSERT INTO platform_recovery_jobs(id,merchant_id,platform_user_id,session_id,grant_id,archive_id,kind,preview_id,reason,authorization_mode,platform_token_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'platform',$10) RETURNING id,status`,[b.request_id,mid,user.id,claims.sid,null,b.archive_id,b.kind,b.preview_id??null,b.reason,claims.version])).rows[0];await c.query("INSERT INTO platform_audit(platform_user_id,merchant_id,action,detail) VALUES($1,$2,'recovery.requested',$3)",[user.id,mid,JSON.stringify({job_id:row.id,kind:b.kind,archive_id:b.archive_id,authorization_mode:'platform'})]);return row;
 });
}));
