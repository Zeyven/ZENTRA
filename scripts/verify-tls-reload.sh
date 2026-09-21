set -Eeuo pipefail
test ! -e /etc/nginx/conf.d/za-spa-saas.conf
trap 'rm -f -- /etc/nginx/conf.d/za-spa-saas.conf; nginx -t && systemctl reload nginx' ERR
install -m 644 /opt/za-spa-saas/saas.nginx.conf /etc/nginx/conf.d/za-spa-saas.conf
nginx -t
systemctl reload nginx
python3 - <<'PY'
import ssl,socket,time,json
context=ssl.create_default_context();started=time.monotonic();samples=[]
for index in range(10):
    try:
        with socket.create_connection(('127.0.0.1',443),timeout=3) as tcp:
            with context.wrap_socket(tcp,server_hostname='saas.zephael.cn') as tls:
                samples.append({'ms':round((time.monotonic()-started)*1000),'verified':True})
    except ssl.SSLCertVerificationError:
        samples.append({'ms':round((time.monotonic()-started)*1000),'verified':False})
    time.sleep(.1)
print(json.dumps({'reload_tls_samples':samples}))
assert all(s['verified'] for s in samples[-5:]),'TLS did not converge to the correct certificate'
PY
curl -fsS --max-time 10 --resolve saas.zephael.cn:443:127.0.0.1 https://saas.zephael.cn/ >/dev/null
curl -fsS --max-time 10 http://127.0.0.1:8787/ready
trap - ERR
