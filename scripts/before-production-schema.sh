set -eu
test "$(systemctl is-active zuyu)" = active
curl -fsS --max-time 10 http://127.0.0.1:8787/ready
python3 /opt/za-spa-saas/operator/backup.py backup --database za_spa_saas
runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -X -p 5433 -d za_spa_saas -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'"
