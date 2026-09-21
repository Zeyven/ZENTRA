"""Install only the independent SaaS backup operator, then exercise its test DB."""
import sys
from pathlib import Path
from remote import connect
client = connect()
try:
    _, output, error = client.exec_command('install -d -m 700 /opt/za-spa-saas/operator')
    if output.channel.recv_exit_status(): raise RuntimeError('Could not create SaaS operator directory')
    sftp = client.open_sftp()
    sftp.put(str(Path(__file__).with_name('saas-backup.py')), '/opt/za-spa-saas/operator/backup.py')
    sftp.chmod('/opt/za-spa-saas/operator/backup.py', 0o700); sftp.close()
    _, output, error = client.exec_command('python3 -u /opt/za-spa-saas/operator/backup.py exercise --database za_spa_saas_test', timeout=900)
    for line in output: print(line, end='', flush=True)
    status = output.channel.recv_exit_status()
    if status: print(error.read().decode(), file=sys.stderr)
    raise SystemExit(status)
finally:
    client.close()
