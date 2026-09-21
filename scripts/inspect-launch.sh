set -eu
date -u +%FT%TZ
node --version
command -v node
command -v nginx
command -v certbot || true
getent ahostsv4 saas.zephael.cn
ss -ltn '( sport = :8791 or sport = :5433 or sport = :80 or sport = :443 )'
find /etc/nginx -maxdepth 2 -type f -name '*saas*' -print
ls -ld /opt/za-spa-saas /opt/za-spa-saas/production.env /opt/za-spa-saas/health
getent passwd za-spa-saas || true
nginx -t
