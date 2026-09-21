"""Root-only fixed-database recovery worker. API submits metadata, never shell/SQL."""
import importlib.util,json,os,re,sys,fcntl,subprocess
from contextlib import contextmanager
from pathlib import Path
spec=importlib.util.spec_from_file_location('restore',Path(__file__).with_name('tenant-restore.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
b=r.backup
DB=os.environ.get('SAAS_RECOVERY_DATABASE','za_spa_saas')
assert DB in b.DATABASES

def lit(v):return "'"+str(v).replace("'","''")+"'"
def q(s):return b.sql(DB,s)
def data(s):return json.loads(q("SELECT coalesce(json_agg(x),'[]') FROM ("+s+") x"))
def eligibility(job):
 if job['authorization_mode']=='platform':
  return "EXISTS(SELECT 1 FROM platform_users p JOIN platform_sessions s ON s.user_id=p.id WHERE p.id="+str(int(job['platform_user_id']))+" AND p.active=true AND p.token_version="+str(int(job['platform_token_version']))+" AND s.id="+lit(job['session_id'])+"::uuid AND s.revoked_at IS NULL AND s.expires_at>now())"
 return "EXISTS(SELECT 1 FROM support_grants g JOIN platform_users p ON p.id=g.platform_user_id AND p.active=true JOIN platform_sessions s ON s.user_id=p.id JOIN merchant_users u ON u.merchant_id=g.merchant_id AND u.id=g.owner_id AND u.role='owner' AND u.active=1 WHERE g.id="+lit(job['grant_id'])+"::uuid AND g.merchant_id="+lit(job['merchant_id'])+"::uuid AND p.id="+str(int(job['platform_user_id']))+" AND s.id="+lit(job['session_id'])+"::uuid AND s.revoked_at IS NULL AND s.expires_at>now() AND g.scope='maintenance' AND g.revoked_at IS NULL AND g.expires_at>now())"
def guard(job):return "DO $$ BEGIN IF NOT "+eligibility(job)+" THEN RAISE EXCEPTION 'Recovery authorization expired'; END IF; END $$;"

@contextmanager
def merchant_lock(job):
 # Keep the exclusive lock across suspension, rollback snapshot and replacement,
 # including callbacks which normally remain allowed for suspended merchants.
 process=subprocess.Popen(b.command('psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d',DB),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
 try:
  process.stdin.write("SET statement_timeout='15s'; DO $$ BEGIN PERFORM pg_advisory_lock(hashtextextended("+lit(job['merchant_id']+':restore')+",0)); END $$; SELECT pg_backend_pid();\n");process.stdin.flush()
  pid=process.stdout.readline().strip()
  if not pid.isdigit():raise RuntimeError('Could not lock merchant for recovery')
  yield int(pid)
 finally:
  if process.poll() is None:
   process.stdin.close()
   try:process.wait(timeout=15)
   except subprocess.TimeoutExpired:process.kill();process.wait()
def prepare_source(source):
 current=set(q('SELECT version FROM schema_migrations').splitlines())
 archived=set(b.sql(source,'SELECT version FROM schema_migrations').splitlines())
 if archived-current:raise RuntimeError('Archive schema is newer or incompatible')
 for name in sorted(current-archived):
  if not re.fullmatch(r'\d{3}-[a-z0-9-]+\.sql',name):raise RuntimeError('Invalid migration identity')
  path=Path(__file__).with_name('migrations')/name
  if not path.is_file() or path.is_symlink():raise RuntimeError('Missing trusted migration for archived schema')
  # Only the verified temporary database is upgraded. The archive and live database are untouched.
  b.sql(source,'BEGIN; '+path.read_text(encoding='utf-8')+'\nINSERT INTO schema_migrations(version) VALUES('+lit(name)+'); COMMIT;')
def sync():
 q('UPDATE platform_backup_archives SET available=false')
 for archive in b.BASE.glob(DB+'-*.dump'):
  if not b.SAFE_DUMP.fullmatch(archive.name) or archive.is_symlink():continue
  try:
   m=json.loads(archive.with_suffix('.json').read_text())
   if m['database']!=DB or not re.fullmatch('[a-f0-9]{64}',m['sha256']):continue
   stamp=m['created_at'];assert re.fullmatch(r'\d{8}T\d{6}Z',stamp)
   q('INSERT INTO platform_backup_archives(id,created_at,sha256,bytes) VALUES('+lit(archive.name)+",to_timestamp("+lit(stamp)+",'YYYYMMDD\"T\"HH24MISS\"Z\"'),"+lit(m['sha256'])+','+str(int(m['bytes']))+") ON CONFLICT(id) DO UPDATE SET available=true,checked_at=now()")
  except (ValueError,KeyError,AssertionError,OSError):continue

def run(job):
 jid=lit(job['id'])+'::uuid';mid=lit(job['merchant_id'])+'::uuid'
 try:
  q(guard(job))
  archive=b.BASE/job['archive_id']
  def verified(source,manifest):
   if manifest['database']!=DB:raise RuntimeError('Archive database mismatch')
   q(guard(job))
   prepare_source(source)
   source_identity=r.json_query(source,'SELECT id,code,member_mode FROM merchants WHERE id='+mid)
   target_identity=data('SELECT id,code,member_mode FROM merchants WHERE id='+mid)
   if not source_identity or source_identity!=target_identity:raise RuntimeError('Merchant missing or incompatible in archive')
   if b.sql(source,"SELECT string_agg(version,',' ORDER BY version) FROM schema_migrations")!=q("SELECT string_agg(version,',' ORDER BY version) FROM schema_migrations"):raise RuntimeError('Archive schema differs; operator migration is required before recovery')
   tables=r.json_query(source,"SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='merchant_id'")
   counts={x['table_name']:int(b.sql(source,'SELECT count(*) FROM '+b.quote(x['table_name'])+' WHERE merchant_id='+mid)) for x in tables if x['table_name'] not in r.PRESERVE|r.DISCARD}
   result={'archive_sha256':manifest['sha256'],'counts':counts,'accounts_preserved':True,'ends_suspended':job['kind']=='restore'}
   if job['kind']=='preview':
    q(guard(job)+"UPDATE platform_recovery_jobs SET status='succeeded',result="+lit(json.dumps(result))+"::jsonb,finished_at=now() WHERE id="+jid);return
   preview=data("SELECT result FROM platform_recovery_jobs WHERE id="+lit(job['preview_id'])+"::uuid AND status='succeeded' AND finished_at>now()-interval '30 minutes'")
   if not preview or preview[0]['result']['archive_sha256']!=manifest['sha256']:raise RuntimeError('Recovery preview expired or archive changed')
   with merchant_lock(job) as lock_owner:
    q('BEGIN; '+guard(job)+" UPDATE merchants SET status='suspended' WHERE id="+mid+"; SELECT pg_notify('saas_access',"+lit(json.dumps({'merchant_id':job['merchant_id']}))+"); COMMIT;")
    rollback=b.backup(DB)
    result['rollback_archive']=rollback.name
    completion="UPDATE platform_recovery_jobs SET status='succeeded',result="+lit(json.dumps(result))+"::jsonb,finished_at=now() WHERE id="+jid+';'
    r.restore_business(source,DB,job['merchant_id'],manifest['sha256'],job['reason'],rollback.name,guard(job),completion,lock_owner)
  b.verify(archive,verified)
 except Exception as error:
  # A committed restoration is never retried just because temporary cleanup failed.
  q("UPDATE platform_recovery_jobs SET status='failed',error="+lit(str(error)[:300])+",finished_at=now() WHERE id="+jid+" AND status<>'succeeded'")
  print(json.dumps({'job':job['id'],'status':'finished_with_error'}),flush=True)

if __name__=='__main__':
 if os.geteuid()!=0:raise SystemExit('Operator service required')
 os.umask(0o077)
 with open('/opt/za-spa-saas/operator/recovery-'+DB+'.lock','w') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise SystemExit(0)
  # No automatic retry after a crashed process; transaction status must be inspected.
  q("UPDATE platform_recovery_jobs SET status='failed',error='Recovery worker interrupted; inspect status before a new request',finished_at=now() WHERE status='running'")
  sync()
  jobs=json.loads(q("WITH next AS (SELECT id FROM platform_recovery_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1), claimed AS (UPDATE platform_recovery_jobs j SET status='running' FROM next WHERE j.id=next.id RETURNING j.*) SELECT coalesce(json_agg(claimed),'[]') FROM claimed"))
  for job in jobs:run(job)
