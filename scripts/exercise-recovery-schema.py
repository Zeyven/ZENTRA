import importlib.util,os,json
from pathlib import Path
os.environ['SAAS_RECOVERY_DATABASE']='za_spa_saas_test'
spec=importlib.util.spec_from_file_location('worker',Path(__file__).with_name('recovery-worker.py'))
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
b=w.b
archive=max(b.BASE.glob('za_spa_saas_test-*.dump'),key=lambda p:p.stat().st_mtime)
before=w.q("SELECT string_agg(version,',' ORDER BY version) FROM schema_migrations")
def verify(source,manifest):
 b.sql(source,"DROP TRIGGER IF EXISTS platform_operation_audited ON audit_events; DROP FUNCTION IF EXISTS mirror_platform_operation_audit(); ALTER TABLE merchant_users DROP COLUMN IF EXISTS platform_user_id; DROP TABLE platform_recovery_jobs; DROP TABLE platform_backup_archives; DELETE FROM schema_migrations WHERE version>='038-'")
 w.prepare_source(source)
 assert b.sql(source,"SELECT string_agg(version,',' ORDER BY version) FROM schema_migrations")==before
 assert b.sql(source,"SELECT to_regclass('public.platform_recovery_jobs')")=='platform_recovery_jobs'
 assert b.sql(source,"SELECT count(*) FROM information_schema.columns WHERE table_name='platform_recovery_jobs' AND column_name='authorization_mode'")=='1'
 print(json.dumps({'old_schema_upgraded_in_temporary_database':True}),flush=True)
b.verify(archive,verify)
assert w.q("SELECT string_agg(version,',' ORDER BY version) FROM schema_migrations")==before
mid='11111111-1111-4111-8111-111111111111'
with w.merchant_lock({'merchant_id':mid}) as pid:
 assert w.q("SELECT pg_try_advisory_xact_lock_shared(hashtextextended('"+mid+":restore',0))")=='f'
assert w.q("SELECT pg_try_advisory_xact_lock_shared(hashtextextended('"+mid+":restore',0))")=='t'
print(json.dumps({'recovery_blocks_concurrent_tenant_write':True,'lock_released':True}),flush=True)
