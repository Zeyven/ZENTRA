set -u
systemctl is-active zuyu
curl -sS -o /dev/null -w 'Old web HTTP %{http_code}\n' --max-time 10 http://127.0.0.1:8787/
systemctl status postgresql@16-za_saas --no-pager -l || true
journalctl -u postgresql@16-za_saas --no-pager -n 60
tail -n 60 /var/log/postgresql/postgresql-16-za_saas.log
ls -ld /opt /opt/za-spa-saas /opt/za-spa-saas/postgres
pg_lsclusters
sed -n '55,70p' /etc/postgresql/16/za_saas/postgresql.conf
grep -E '^(timezone|shared_buffers|listen_addresses)' /etc/postgresql/16/za_saas/postgresql.conf
pg_conftool --help
getent ahostsv4 saas.zephael.cn || true
