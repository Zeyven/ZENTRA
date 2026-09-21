"""Run on the SaaS host as root. Fixed cluster and database allowlists only.

backup: consistent custom archive + SHA-256 manifest, 30 day retention.
verify: restore into a fresh temporary database; never overwrite a live database.
"""
import argparse, datetime, hashlib, json, os, re, shutil, subprocess, uuid
from pathlib import Path

BASE = Path('/opt/za-spa-saas/backups')
BIN = Path('/usr/lib/postgresql/16/bin')
DATABASES = {'za_spa_saas', 'za_spa_saas_test'}
SAFE_DUMP = re.compile(r'za_spa_saas(?:_test)?-\d{8}T\d{6}Z-[a-f0-9]{8}\.dump')

def command(program, *args):
    return ['runuser', '-u', 'postgres', '--', str(BIN / program), '-p', '5433', *args]

def sql(database, statement):
    result = subprocess.run(command('psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', statement), capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError('Database verification command failed')
    return result.stdout.decode().strip()

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def space(database, restore=False):
    usage = shutil.disk_usage(BASE)
    size = int(sql(database, 'SELECT pg_database_size(current_database())'))
    if usage.free < max(3 * 1024**3 + size * (3 if restore else 1), usage.total // 10):
        raise RuntimeError('Insufficient free disk space; protect the existing service')

def quote(identifier):
    return '"' + identifier.replace('"', '""') + '"'

def fingerprint(database, snapshot=None):
    tables = sql(database, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
    result = {}
    for table in tables:
        prefix = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET TRANSACTION SNAPSHOT '" + snapshot + "'; " if snapshot else ''
        query = prefix + 'COPY (SELECT to_jsonb(t)::text FROM public.' + quote(table) + ' t ORDER BY to_jsonb(t)::text) TO STDOUT'
        with subprocess.Popen(command('psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', query), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
            digest = hashlib.sha256()
            for chunk in iter(lambda: process.stdout.read(1024 * 1024), b''):
                digest.update(chunk)
            if process.wait(timeout=120):
                raise RuntimeError('Table fingerprint failed')
        result[table] = digest.hexdigest()
    return result

def backup(database, with_fingerprint=False):
    space(database)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    archive = BASE / f'{database}-{stamp}-{uuid.uuid4().hex[:8]}.dump'
    partial = archive.with_suffix('.part')
    keeper = subprocess.Popen(command('psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', database), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        keeper.stdin.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();\n'); keeper.stdin.flush()
        snapshot = keeper.stdout.readline().strip()
        if not re.fullmatch(r'[A-Fa-f0-9-]+', snapshot):
            raise RuntimeError('Could not obtain a consistent backup snapshot')
        with partial.open('xb') as stream:
            result = subprocess.run(command('pg_dump', '-Fc', '--snapshot=' + snapshot, '--lock-wait-timeout=10s', '-d', database), stdout=stream, stderr=subprocess.PIPE, timeout=600)
            stream.flush(); os.fsync(stream.fileno())
        if result.returncode:
            raise RuntimeError('pg_dump failed; incomplete archive was not published')
        expected = fingerprint(database, snapshot) if with_fingerprint else None
        partial.replace(archive)
        manifest = {'database': database, 'created_at': stamp, 'sha256': sha(archive), 'bytes': archive.stat().st_size, 'format': 'postgresql-16-custom', 'tables': expected}
        archive.with_suffix('.json').write_text(json.dumps(manifest), encoding='utf8')
        # Only remove our dated files after a new successful backup exists.
        cutoff = datetime.datetime.now(datetime.timezone.utc).timestamp() - 30 * 86400
        for old in BASE.iterdir():
            if SAFE_DUMP.fullmatch(old.name) and old.name.startswith(database + '-') and not old.is_symlink() and old.stat().st_mtime < cutoff:
                old.unlink(); old.with_suffix('.json').unlink(missing_ok=True)
        print(json.dumps({'event': 'backup.created', 'file': archive.name, 'bytes': manifest['bytes'], 'sha256': manifest['sha256']}), flush=True)
        return archive
    finally:
        if keeper.poll() is None:
            keeper.stdin.write('ROLLBACK;\n'); keeper.stdin.close(); keeper.wait(timeout=15)
        partial.unlink(missing_ok=True)

def verify(archive, action=None):
    if not SAFE_DUMP.fullmatch(archive.name) or archive.is_symlink() or archive.parent.resolve() != BASE.resolve():
        raise RuntimeError('Archive must be a locally created SaaS backup')
    manifest = json.loads(archive.with_suffix('.json').read_text())
    if manifest['database'] not in DATABASES or sha(archive) != manifest['sha256']:
        raise RuntimeError('Backup integrity or database identity mismatch')
    space(manifest['database'], restore=True)
    temporary = 'saas_restore_' + uuid.uuid4().hex
    sql('postgres', 'CREATE DATABASE ' + quote(temporary) + ' OWNER saas_migrator')
    try:
        sql('postgres', 'REVOKE CONNECT ON DATABASE ' + quote(temporary) + ' FROM PUBLIC')
        with archive.open('rb') as stream:
            result = subprocess.run(command('pg_restore', '--exit-on-error', '--single-transaction', '-d', temporary), stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=600)
        if result.returncode:
            raise RuntimeError('Temporary restore failed')
        actual = fingerprint(temporary)
        if manifest.get('tables') is not None and actual != manifest['tables']:
            raise RuntimeError('Restored table data differs from the original backup snapshot')
        invalid = sql(temporary, "SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated")
        if invalid != '0':
            raise RuntimeError('Unvalidated database constraints after restore')
        print(json.dumps({'event': 'backup.restore_verified', 'file': archive.name, 'tables': len(actual), 'snapshot_compared': manifest.get('tables') is not None}), flush=True)
        if action is not None:action(temporary,manifest)
    finally:
        # This generated, unpublished scratch database is the only drop target.
        if not re.fullmatch(r'saas_restore_[a-f0-9]{32}', temporary):
            raise RuntimeError('Invalid temporary database name')
        sql('postgres', 'DROP DATABASE ' + quote(temporary))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['backup', 'verify', 'exercise'])
    parser.add_argument('--database', choices=sorted(DATABASES), default='za_spa_saas')
    parser.add_argument('--archive')
    options = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run through the dedicated operator service')
    os.umask(0o077); BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    if options.action == 'verify':
        if not options.archive: parser.error('--archive is required')
        verify(BASE / options.archive)
    else:
        archive = backup(options.database, options.action == 'exercise')
        if options.action == 'exercise': verify(archive)
