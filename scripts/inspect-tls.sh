set -eu
openssl x509 -in /opt/za-spa-saas/certbot/live/saas.zephael.cn/fullchain.pem -noout -subject -dates -ext subjectAltName
journalctl -u nginx --since '10 minutes ago' --no-pager -n 18
nginx -T 2>&1 | grep -E '^# configuration file|include.*conf.d|listen.*443|server_name' | head -n 45
test ! -e /etc/nginx/conf.d/za-spa-saas.conf
systemctl is-active zuyu
curl -fsS --max-time 10 http://127.0.0.1:8787/ready
