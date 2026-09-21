"""Server-side test: only disposable database clones are modified."""
import importlib.util,json,subprocess,uuid,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('tenant_restore',Path(__file__).with_name('tenant-restore.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
backup=module.backup
archive=max(backup.BASE.glob('za_spa_saas_test-*.dump'),key=lambda p:p.stat().st_mtime)
manifest=json.loads(archive.with_suffix('.json').read_text())
assert manifest['database']=='za_spa_saas_test' and backup.sha(archive)==manifest['sha256'] and manifest['tables']
databases=[]
def clone():
    database='saas_restore_'+uuid.uuid4().hex
    backup.sql('postgres','CREATE DATABASE '+backup.quote(database)+' OWNER saas_migrator');databases.append(database)
    backup.sql('postgres','REVOKE CONNECT ON DATABASE '+backup.quote(database)+' FROM PUBLIC')
    with archive.open('rb') as stream:
        result=subprocess.run(backup.command('pg_restore','--exit-on-error','--single-transaction','-d',database),stdin=stream,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=600)
    if result.returncode:raise RuntimeError('Test clone restore failed')
    return database
def tenant_fingerprint(database,mid):
    tables=module.json_query(database,"SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='merchant_id' ORDER BY table_name")
    digest=hashlib.sha256()
    for table in tables:
        value=backup.sql(database,'SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),\'[]\'::jsonb) FROM '+backup.quote(table['table_name'])+" t WHERE merchant_id='"+mid+"'::uuid")
        digest.update(value.encode())
    return digest.hexdigest()
try:
    source=clone();assert backup.fingerprint(source)==manifest['tables'];target=clone()
    merchants=module.json_query(source,"SELECT DISTINCT merchant_id FROM members ORDER BY merchant_id LIMIT 2")
    assert len(merchants)==2
    a,b=[row['merchant_id'] for row in merchants]
    before_a=backup.sql(source,"SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM members m WHERE merchant_id='"+a+"'")
    backup.sql(target,"UPDATE members SET name='post-backup edit' WHERE merchant_id='"+a+"'; UPDATE members SET name='other merchant current data' WHERE merchant_id='"+b+"'; UPDATE merchants SET status='suspended' WHERE id='"+a+"'")
    unchanged=tenant_fingerprint(target,b)
    passwords=backup.sql(target,"SELECT jsonb_agg(jsonb_build_array(id,password,active) ORDER BY id)::text FROM merchant_users WHERE merchant_id='"+a+"'")
    print(json.dumps({'event':'tenant_restore.exercise_started'}),flush=True)
    store=backup.sql(target,"SELECT id FROM stores WHERE merchant_id='"+a+"' AND deleted_at IS NULL ORDER BY id LIMIT 1")
    assert store.isdigit()
    backup.sql(target,"UPDATE stores SET status=0,deleted_at=now() WHERE id="+store)
    try:backup.sql(target,"UPDATE stores SET status=1,deleted_at=NULL WHERE id="+store)
    except RuntimeError:pass
    else:raise AssertionError('Permanent store protection was bypassed without a recovery context')
    result=module.restore_business(source,target,a,manifest['sha256'])
    assert backup.sql(target,"SELECT deleted_at IS NULL FROM stores WHERE id="+store)=='t'
    assert backup.sql(target,"SELECT jsonb_agg(to_jsonb(m) ORDER BY id)::text FROM members m WHERE merchant_id='"+a+"'")==before_a
    assert tenant_fingerprint(target,b)==unchanged
    assert backup.sql(target,"SELECT jsonb_agg(jsonb_build_array(id,password,active) ORDER BY id)::text FROM merchant_users WHERE merchant_id='"+a+"'")==passwords
    assert backup.sql(target,"SELECT count(*) FROM merchant_sessions WHERE merchant_id='"+a+"' AND revoked_at IS NULL")=='0'
    assert backup.sql(target,"SELECT status FROM merchants WHERE id='"+a+"'")=='suspended'
    # Inject a failure after delete/insert work has begun; all earlier work must roll back.
    backup.sql(target,"UPDATE members SET name='must survive failed restore' WHERE merchant_id='"+a+"'; CREATE FUNCTION public.restore_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'RESTORE_TEST_FAILURE'; END $$; CREATE TRIGGER restore_test_failure BEFORE INSERT ON members FOR EACH ROW EXECUTE FUNCTION restore_test_failure()")
    before_failure=tenant_fingerprint(target,a)
    try:module.restore_business(source,target,a,manifest['sha256'])
    except RuntimeError as error:assert 'rolled back' in str(error)
    else:raise AssertionError('Injected restore failure was not propagated')
    assert tenant_fingerprint(target,a)==before_failure
    assert tenant_fingerprint(target,b)==unchanged
    print(json.dumps({'event':'tenant_restore.exercise_passed','other_merchant_unchanged':True,'credentials_preserved':True,'sessions_revoked':True,'failure_atomic':True,'restored_tables':result['restored_tables']}),flush=True)
finally:
    for database in reversed(databases):
        assert database.startswith('saas_restore_') and len(database)==45
        backup.sql('postgres','DROP DATABASE '+backup.quote(database))
