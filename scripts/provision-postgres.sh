set -eu
test "$(systemctl is-active zuyu)" = active
curl -fsS --max-time 5 http://127.0.0.1:8787/ready
if test ! -e /opt/za-spa-saas; then install -d -m 755 /opt/za-spa-saas; fi
test ! -e /opt/za-spa-saas/postgres
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get install -y --no-install-recommends postgresql-common
# Configure only the newly installed PostgreSQL service; no existing cluster exists.
test -z "$(pg_lsclusters --no-header)"
printf '\ncreate_main_cluster = false\n' >> /etc/postgresql-common/createcluster.conf
apt-get install -y --no-install-recommends postgresql-16
pg_createcluster 16 za_saas --port=5433 --datadir=/opt/za-spa-saas/postgres --start-conf=manual --locale=C.UTF-8 --encoding=UTF8
sed -i "s/^#listen_addresses =.*/listen_addresses = '127.0.0.1'/" /etc/postgresql/16/za_saas/postgresql.conf
pg_conftool 16 za_saas set shared_buffers '128MB'
pg_conftool 16 za_saas set max_connections 30
pg_conftool 16 za_saas set timezone 'Asia/Shanghai'
install -d -m 755 /etc/systemd/system/postgresql@16-za_saas.service.d
printf '[Service]\nMemoryMax=1G\nCPUQuota=60%%\n' > /etc/systemd/system/postgresql@16-za_saas.service.d/limits.conf
systemctl daemon-reload
systemctl enable --now postgresql@16-za_saas
runuser -u postgres -- psql -p 5433 -d postgres -Atc 'select version()'
test "$(systemctl is-active zuyu)" = active
curl -fsS --max-time 5 http://127.0.0.1:8787/ready
