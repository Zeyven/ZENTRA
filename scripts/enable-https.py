"""Add only the SaaS virtual host. Any failed check removes the new entry."""
from pathlib import Path
import sys
from remote import connect
root=Path(__file__).resolve().parents[1]
c=connect()
try:
 s=c.open_sftp();s.put(str(root/'scripts/saas.nginx.conf'),'/opt/za-spa-saas/saas.nginx.conf');s.close()
 script=r'''set -Eeuo pipefail
target=/etc/nginx/conf.d/za-spa-saas.conf
test ! -e "$target"
test "$(systemctl is-active zuyu)" = active
curl -fsS --max-time 10 http://127.0.0.1:8787/ready >/dev/null
curl -fsS --max-time 10 http://127.0.0.1:8791/ready >/dev/null
# Confirm no existing virtual host claims the new domain.
if nginx -T 2>&1 | grep -E '^[[:space:]]*server_name[[:space:]].*saas\.zephael\.cn'; then exit 1; fi
test "$(getent ahostsv4 saas.zephael.cn | awk '{print $1}' | sort -u)" = 139.196.162.194
rollback() { rm -f -- /etc/nginx/conf.d/za-spa-saas.conf; if nginx -t; then systemctl reload nginx; fi; }
trap rollback ERR
install -d -m 755 /opt/za-spa-saas/acme
cat > "$target" <<'NGINX'
server {
 listen 80;
 server_name saas.zephael.cn;
 location ^~ /.well-known/acme-challenge/ { root /opt/za-spa-saas/acme; }
 location / { return 503; }
}
NGINX
nginx -t
systemctl reload nginx
curl -fsS --max-time 10 http://127.0.0.1:8787/ready >/dev/null
certbot certonly --webroot -w /opt/za-spa-saas/acme -d saas.zephael.cn --non-interactive --agree-tos --register-unsafely-without-email --config-dir /opt/za-spa-saas/certbot --work-dir /opt/za-spa-saas/certbot-work --logs-dir /opt/za-spa-saas/certbot-logs
install -m 644 /opt/za-spa-saas/saas.nginx.conf "$target"
nginx -t
systemctl reload nginx
# systemctl reload returns after signaling the master, before all new workers accept.
# Strict TLS readiness is bounded; persistent errors still roll back the new entry.
curl -fsS --retry 10 --retry-all-errors --retry-delay 1 --max-time 3 --resolve saas.zephael.cn:443:127.0.0.1 https://saas.zephael.cn/ >/dev/null
curl -fsS --max-time 10 http://127.0.0.1:8787/ready
test "$(systemctl is-active zuyu)" = active
trap - ERR
'''
 _,out,err=c.exec_command('bash -se',timeout=300);out.channel.sendall(script.encode());out.channel.shutdown_write()
 for line in out:print(line,end='',flush=True)
 status=out.channel.recv_exit_status();print(err.read().decode(),file=sys.stderr)
 raise SystemExit(status)
finally:c.close()
