import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {backupHealth} from '../apps/server/src/services/operations-health.js';
import {harness,succeeded} from './helpers.js';
test('missing, malformed and stale backup monitoring cannot display healthy or expose unknown metadata',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'saas-monitor-')),file=join(directory,'report.json'),now=Date.now();
 try{
  assert.equal((await backupHealth(file)).status,'unavailable');
  await writeFile(file,JSON.stringify({checked_at:new Date(now).toISOString(),healthy:true,problems:[],disk_free_bytes:123,latest_backup_at:new Date(now).toISOString(),secret:'must-not-appear'}));
  const valid=await backupHealth(file,now);assert.equal(valid.status,'healthy');assert(!JSON.stringify(valid).includes('must-not-appear'));
  assert.equal((await backupHealth(file,now+31*60000)).status,'stale');
  await writeFile(file,'broken');assert.equal((await backupHealth(file)).status,'unavailable');
 }finally{await unlink(file);await rmdir(directory)}
});
test('operations health is platform-only and missing monitor evidence is reported as unavailable',async()=>{
 const h=await harness();try{const merchant=await h.onboard();const result=succeeded(await h.call('/api/platform/v1/operations','GET',undefined,h.platformToken));assert.equal(result.database,'healthy');assert.equal(result.backup.status,'unavailable');assert.equal(result.jobs.healthy,false);assert.equal((await h.call('/api/platform/v1/operations','GET',undefined,merchant.token)).status,401);assert.equal((await h.call('/api/platform/v1/operations')).status,401)}finally{await h.stop()}
});
