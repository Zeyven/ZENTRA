from pathlib import Path
from remote import connect
root=Path(__file__).resolve().parents[1];c=connect()
try:
 s=c.open_sftp()
 for name in ['za-spa-saas-cert-renew.service','za-spa-saas-cert-renew.timer']:
  s.put(str(root/'scripts'/name),'/etc/systemd/system/'+name);s.chmod('/etc/systemd/system/'+name,0o644)
 s.close()
 _,out,err=c.exec_command('systemctl daemon-reload && systemctl enable --now za-spa-saas-cert-renew.timer && certbot renew --dry-run --no-random-sleep-on-renew --config-dir /opt/za-spa-saas/certbot --work-dir /opt/za-spa-saas/certbot-work --logs-dir /opt/za-spa-saas/certbot-logs',timeout=300)
 for line in out:print(line,end='',flush=True)
 status=out.channel.recv_exit_status();print(err.read().decode());raise SystemExit(status)
finally:c.close()
