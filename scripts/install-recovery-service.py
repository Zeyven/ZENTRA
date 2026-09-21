"""Run only as part of the authorized deployment after migrations 037 through 041."""
from pathlib import Path
from remote import connect
c=connect()
try:
    s=c.open_sftp()
    for src,dst in [('saas-backup.py','backup.py'),('saas-tenant-restore.py','tenant-restore.py'),('saas-recovery-worker.py','recovery-worker.py')]:
        path='/opt/za-spa-saas/operator/'+dst
        s.put(str(Path(__file__).with_name(src)),path);s.chmod(path,0o700)
    directory='/opt/za-spa-saas/operator/migrations'
    try:s.mkdir(directory,0o700)
    except OSError:s.stat(directory)
    for migration in (Path(__file__).resolve().parents[1]/'apps/server/src/db').glob('*.sql'):
        s.put(str(migration),directory+'/'+migration.name);s.chmod(directory+'/'+migration.name,0o600)
    for name in ['za-spa-saas-recovery.service','za-spa-saas-recovery.timer']:
        s.put(str(Path(__file__).with_name(name)),'/etc/systemd/system/'+name);s.chmod('/etc/systemd/system/'+name,0o644)
    s.close()
    _,out,err=c.exec_command('systemctl daemon-reload && systemctl enable --now za-spa-saas-recovery.timer',timeout=60)
    status=out.channel.recv_exit_status()
    if status:raise RuntimeError(err.read().decode())
    print('Recovery worker timer enabled')
finally:c.close()
