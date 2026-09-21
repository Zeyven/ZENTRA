set -eu
grep '/updates/windows/rc/' /var/log/nginx/za-spa-saas.access.log | tail -n 12
ls -l /opt/za-spa-saas/updates/windows/rc
grep -E 'random|sleep|simulat|renewal' /opt/za-spa-saas/certbot-logs/letsencrypt.log | tail -n 6
curl -fsSI --max-time 15 -H 'Range: bytes=0-1023' https://saas.zephael.cn/updates/windows/rc/ZA-Thera-1.0.0-rc.1-Windows-x64.exe
