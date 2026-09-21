set -Eeuo pipefail
systemctl stop za-spa-saas.service
test "$(systemctl show za-spa-saas.service -p ExecMainStatus --value)" = 0
systemctl start za-spa-saas.service
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:8791/ready
systemctl start za-spa-saas-backup.service
systemctl start za-spa-saas-backup-monitor.service
systemctl show za-spa-saas-backup.service -p Result -p ExecMainStatus
systemctl is-active za-spa-saas-backup.timer za-spa-saas-backup-monitor.timer za-spa-saas-cert-renew.timer
cat /opt/za-spa-saas/health/backup.json
runuser -u postgres -- psql -X -p 5433 -d za_spa_saas -Atc 'SELECT (SELECT count(*) FROM merchants),(SELECT count(*) FROM platform_users),(SELECT count(*) FROM orders),(SELECT count(*) FROM members)'
systemctl is-active zuyu
curl -fsS --max-time 10 http://127.0.0.1:8787/ready
nginx -t
