"""Offline, scoped business restoration. All constraints remain enabled.

Use only after a full archive has been verified in a temporary database.
Current passwords/account status are retained. Sessions and support grants are revoked.
"""
import importlib.util, json, re, subprocess, tempfile
from pathlib import Path

spec=importlib.util.spec_from_file_location('saas_backup',Path(__file__).with_name('backup.py'))
backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
sql,command,quote=backup.sql,backup.command,backup.quote
PRESERVE={'merchants','merchant_users','merchant_sessions','support_grants','owner_invites','platform_audit','platform_recovery_jobs'}
DISCARD={'domain_events','idempotency_records','merchant_operation_requests','room_warning_batches','public_rate_limits','coupon_claim_invitations','maintenance_events','hardware_gateways','hardware_bindings'}

def json_query(database,query):
    value=sql(database,'SELECT coalesce(json_agg(x),\'[]\'::json) FROM ('+query+') x')
    return json.loads(value)

def restore_business(source,target,merchant_id,archive_sha,reason='isolated restore exercise',rollback_archive=None, guard_sql=None, completion_sql=None, lock_owner=None):
    if not re.fullmatch(r'[a-f0-9-]{36}',merchant_id):raise RuntimeError('Invalid merchant identity')
    if not re.fullmatch(r'saas_restore_[a-f0-9]{32}',source):raise RuntimeError('Source must be a verified temporary restore')
    if target not in backup.DATABASES and not re.fullmatch(r'saas_restore_[a-f0-9]{32}',target):raise RuntimeError('Invalid restoration target')
    mid="'"+merchant_id+"'::uuid"
    source_merchant=json_query(source,'SELECT id,code,member_mode FROM merchants WHERE id='+mid)
    target_merchant=json_query(target,'SELECT id,code,member_mode FROM merchants WHERE id='+mid)
    if len(source_merchant)!=1 or source_merchant!=target_merchant:raise RuntimeError('Merchant identity or membership mode does not match')
    if sql(source,'SELECT string_agg(version,\',\' ORDER BY version) FROM schema_migrations')!=sql(target,'SELECT string_agg(version,\',\' ORDER BY version) FROM schema_migrations'):raise RuntimeError('Schema versions must match before tenant restoration')
    source_users=json_query(source,'SELECT id FROM merchant_users WHERE merchant_id='+mid)
    target_users=json_query(target,'SELECT id FROM merchant_users WHERE merchant_id='+mid)
    if not {u['id'] for u in source_users}.issubset({u['id'] for u in target_users}):raise RuntimeError('Historical user identities missing; restore cannot recreate account authorization')
    tables=[row['table_name'] for row in json_query(source,"SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='merchant_id' ORDER BY table_name") if row['table_name'] not in PRESERVE]
    edges=json_query(source,"SELECT conrelid::regclass::text child,confrelid::regclass::text parent FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace")
    pending=set(tables);ordered=[]
    while pending:
        ready=sorted(t for t in pending if not any(e['child']==t and e['parent']!=t and e['parent'] in pending for e in edges))
        if not ready:raise RuntimeError('Unsupported foreign-key cycle; no data was changed')
        ordered.extend(ready);pending.difference_update(ready)
    with tempfile.NamedTemporaryFile(dir=backup.BASE,suffix='.restore.sql',mode='w+b') as script:
        def emit(statement):script.write((statement+'\n').encode())
        emit("BEGIN; SET LOCAL lock_timeout='15s'; SET LOCAL statement_timeout='120s';")
        if lock_owner is None:
            emit("SELECT pg_advisory_xact_lock(hashtextextended('"+merchant_id+":restore',0));")
        else:
            # The worker holds this same merchant lock throughout rollback backup and restore.
            emit("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid="+str(int(lock_owner))+" AND locktype='advisory' AND mode='ExclusiveLock' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND classid=((hashtextextended('"+merchant_id+":restore',0)>>32)&4294967295)::oid AND objid=(hashtextextended('"+merchant_id+":restore',0)&4294967295)::oid AND objsubid=1) THEN RAISE EXCEPTION 'Recovery lock lost'; END IF; END $$;")
        emit("SELECT set_config('app.merchant_id','"+merchant_id+"',true);")
        emit("SELECT set_config('app.recovery_merchant_id','"+merchant_id+"',true);")
        emit("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM merchants WHERE id="+mid+" AND status='suspended' FOR UPDATE) THEN RAISE EXCEPTION 'Target merchant must be suspended'; END IF; END $$;")
        if guard_sql:emit(guard_sql)
        emit('CREATE TEMP TABLE restore_staff ON COMMIT DROP AS SELECT * FROM staff_store_grants WHERE merchant_id='+mid+';')
        emit('CREATE TEMP TABLE restore_rows(data jsonb) ON COMMIT DROP;')
        for table in reversed(ordered):emit('DELETE FROM public.'+quote(table)+' WHERE merchant_id='+mid+';')
        for table in ordered:
            if table in DISCARD or table=='staff_store_grants':continue
            emit('TRUNCATE restore_rows; COPY restore_rows(data) FROM STDIN;')
            query='COPY (SELECT to_jsonb(t) FROM public.'+quote(table)+' t WHERE merchant_id='+mid+') TO STDOUT'
            script.flush()
            result=subprocess.run(command('psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d',source,'-c',query),stdout=script,stderr=subprocess.PIPE,timeout=120)
            if result.returncode:raise RuntimeError('Could not stage the verified tenant data')
            emit('\\.')
            identity=json_query(source,"SELECT column_name,pg_get_serial_sequence('public.'||table_name,column_name) sequence FROM information_schema.columns WHERE table_schema='public' AND table_name='"+table+"' AND is_identity='YES'")
            for column in identity:
                sequence=column['sequence'];name=column['column_name']
                if not re.fullmatch(r'public\.[a-z_0-9]+',sequence):raise RuntimeError('Unexpected identity sequence')
                emit("DO $$ BEGIN IF EXISTS(SELECT 1 FROM restore_rows WHERE (data->>'"+name+"')::bigint>(SELECT last_value FROM "+sequence+")) THEN RAISE EXCEPTION 'Identity sequence lineage mismatch'; END IF; END $$;")
            emit('INSERT INTO public.'+quote(table)+' OVERRIDING SYSTEM VALUE SELECT row.* FROM restore_rows CROSS JOIN LATERAL jsonb_populate_record(NULL::public.'+quote(table)+',data) row;')
        # Preserve present-day permissions only where their referenced profiles still exist.
        emit('INSERT INTO staff_store_grants SELECT g.* FROM restore_staff g JOIN stores s ON s.merchant_id=g.merchant_id AND s.id=g.store_id WHERE g.role<>\'technician\' OR EXISTS(SELECT 1 FROM technicians t WHERE t.merchant_id=g.merchant_id AND t.id=g.technician_id);')
        emit('UPDATE merchant_users SET token_version=token_version+1 WHERE merchant_id='+mid+';')
        emit('UPDATE merchant_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE merchant_id='+mid+';')
        emit('UPDATE support_grants SET revoked_at=coalesce(revoked_at,now()) WHERE merchant_id='+mid+';')
        detail=json.dumps({'archive_sha256':archive_sha,'reason':reason,'rollback_archive':rollback_archive,'sessions_revoked':True,'account_credentials_preserved':True}).replace("'","''")
        emit("INSERT INTO platform_audit(merchant_id,action,detail) VALUES("+mid+",'merchant.restored','"+detail+"'::jsonb);")
        emit("INSERT INTO audit_events(merchant_id,action,detail) VALUES("+mid+",'merchant.restored','"+detail+"'::jsonb);")
        emit("INSERT INTO domain_events(merchant_id,topic) VALUES("+mid+",'access.revoked');")
        if completion_sql:emit(completion_sql)
        emit('COMMIT;')
        script.flush();script.seek(0)
        result=subprocess.run(command('psql','-X','-q','-v','ON_ERROR_STOP=1','-d',target),stdin=script,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=900)
        if result.returncode:
            # Keep SQL detail off public logs: business values may appear in errors.
            raise RuntimeError('Tenant restore transaction rolled back: '+result.stderr.decode().splitlines()[0][:180])
    return {'merchant_id':merchant_id,'restored_tables':len(set(ordered)-DISCARD-{'staff_store_grants'}),'status':'suspended','sessions_revoked':True}

if __name__=='__main__':
    import argparse,os
    parser=argparse.ArgumentParser(description='Restore one suspended merchant from a locally verified archive; never restores platform data.')
    parser.add_argument('--archive',required=True);parser.add_argument('--database',required=True,choices=sorted(backup.DATABASES));parser.add_argument('--merchant',required=True);parser.add_argument('--reason',required=True);parser.add_argument('--execute',action='store_true',required=True)
    args=parser.parse_args()
    if os.geteuid()!=0:raise SystemExit('Operator root access required')
    if not re.fullmatch(r'[a-f0-9-]{36}',args.merchant) or not args.reason.strip() or len(args.reason)>500:raise SystemExit('Invalid merchant or reason')
    os.umask(0o077)
    archive=backup.BASE/args.archive
    def apply(source,manifest):
        if manifest['database']!=args.database:raise RuntimeError('Archive and target database identities differ')
        if sql(args.database,"SELECT status FROM merchants WHERE id='"+args.merchant+"'::uuid")!='suspended':raise RuntimeError('Suspend the target merchant before restoration')
        rollback=backup.backup(args.database)
        print(json.dumps(restore_business(source,args.database,args.merchant,manifest['sha256'],args.reason.strip(),rollback.name)),flush=True)
    backup.verify(archive,apply)
