from pathlib import Path
from remote import connect
client=connect()
try:
    sftp=client.open_sftp()
    for local,remote in [('saas-backup.py','backup.py'),('saas-tenant-restore.py','tenant-restore.py'),('exercise-tenant-restore.py','exercise-tenant-restore.py')]:
        sftp.put(str(Path(__file__).with_name(local)),'/opt/za-spa-saas/operator/'+remote);sftp.chmod('/opt/za-spa-saas/operator/'+remote,0o700)
    sftp.close()
    _,output,error=client.exec_command('python3 -u /opt/za-spa-saas/operator/exercise-tenant-restore.py',timeout=900)
    for line in output:print(line,end='',flush=True)
    status=output.channel.recv_exit_status()
    if status:print(error.read().decode())
    raise SystemExit(status)
finally:client.close()
