from pathlib import Path
from remote import connect
client=connect()
try:
    sftp=client.open_sftp()
    sftp.put(str(Path(__file__).with_name('saas-backup-monitor.py')),'/opt/za-spa-saas/operator/backup-monitor.py')
    sftp.chmod('/opt/za-spa-saas/operator/backup-monitor.py',0o700)
    units={
      'za-spa-saas-backup.service':'''[Unit]
Description=ZA Thera isolated database backup and restore verification
After=postgresql@16-za_saas.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/za-spa-saas/operator/backup.py exercise --database za_spa_saas
UMask=0077
Nice=19
IOSchedulingClass=idle
MemoryMax=256M
CPUQuota=10%
TimeoutStartSec=30min
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/opt/za-spa-saas/backups
LogRateLimitIntervalSec=60s
LogRateLimitBurst=30
''',
      'za-spa-saas-backup.timer':'''[Unit]
Description=Daily ZA Thera backup, retain 30 days
[Timer]
OnCalendar=*-*-* 03:15:00 Asia/Shanghai
RandomizedDelaySec=5min
Persistent=true
[Install]
WantedBy=timers.target
''',
      'za-spa-saas-backup-monitor.service':'''[Unit]
Description=ZA Thera backup freshness and disk health
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/za-spa-saas/operator/backup-monitor.py
MemoryMax=64M
CPUQuota=5%
Nice=19
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/za-spa-saas/health
''',
      'za-spa-saas-backup-monitor.timer':'''[Unit]
Description=Check ZA Thera backup and disk every 15 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true
[Install]
WantedBy=timers.target
'''}
    for name,content in units.items():
        with sftp.file('/etc/systemd/system/'+name,'w') as stream:stream.write(content)
        sftp.chmod('/etc/systemd/system/'+name,0o644)
    sftp.close()
    command='''set -eu
install -d -m 755 /opt/za-spa-saas/health
systemd-analyze verify /etc/systemd/system/za-spa-saas-backup.service /etc/systemd/system/za-spa-saas-backup.timer /etc/systemd/system/za-spa-saas-backup-monitor.service /etc/systemd/system/za-spa-saas-backup-monitor.timer
systemctl daemon-reload
systemctl start za-spa-saas-backup.service
systemctl start za-spa-saas-backup-monitor.service
systemctl enable --now za-spa-saas-backup.timer za-spa-saas-backup-monitor.timer
systemctl show za-spa-saas-backup.service -p Result -p ExecMainStatus -p MemoryMax -p CPUQuotaPerSecUSec
cat /opt/za-spa-saas/health/backup.json
systemctl is-active zuyu
curl -fsS --max-time 10 http://127.0.0.1:8787/ready
'''
    _,output,error=client.exec_command('bash -se',timeout=900);output.channel.sendall(command.encode());output.channel.shutdown_write()
    for line in output:print(line,end='',flush=True)
    status=output.channel.recv_exit_status()
    if status:print(error.read().decode())
    raise SystemExit(status)
finally:client.close()
