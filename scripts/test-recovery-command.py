import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from remote import connect
c=connect()
try:
 s=c.open_sftp()
 for src,dst in [('scripts/saas-recovery-worker.py','recovery-worker.py'),('scripts/saas-tenant-restore.py','tenant-restore.py')]:s.put(src,'/opt/za-spa-saas/operator-maintenance-test/'+dst)
 s.close()
 action=sys.argv[1]
 commands={'backup':'python3 -u /opt/za-spa-saas/operator-maintenance-test/backup.py backup --database za_spa_saas_test','worker':'env SAAS_RECOVERY_DATABASE=za_spa_saas_test python3 -u /opt/za-spa-saas/operator-maintenance-test/recovery-worker.py'}
 _,o,e=c.exec_command(commands[action],timeout=900)
 for line in o:print(line,end='',flush=True)
 status=o.channel.recv_exit_status();print(e.read().decode());sys.exit(status)
finally:c.close()
