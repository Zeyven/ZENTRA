"""Activate only the independent SaaS API, with rollback on failed health checks."""
import json,re,shlex,sys
from pathlib import Path
from remote import connect
from release_build import verify
root=Path(__file__).resolve().parents[1]
record=json.loads((root/'.runtime/staged-release.json').read_text())
release=record['directory'];assert re.fullmatch(r'/opt/za-spa-saas/releases/\d{8}T\d{6}Z',release)
expected_version=json.loads((root/'package.json').read_text())['version']
if record.get('status')!='ready' or record.get('version')!=expected_version or record.get('build_sha256')!=verify():
 raise RuntimeError('No successful staging record for this exact build')
assert re.fullmatch(r'\d+\.\d+\.\d+(?:-[\w.]+)?',expected_version)
c=connect()
try:
 s=c.open_sftp();s.put(str(root/'scripts/za-spa-saas.service'),'/opt/za-spa-saas/za-spa-saas.service');s.close()
 script=f'''set -eu
legacy_before=$(systemctl is-active zuyu || true)
if test "$legacy_before" = active; then curl -fsS --max-time 10 http://127.0.0.1:8787/ready >/dev/null; fi
test -f {release}/apps/server/dist/index.js
grep -Eq "version: *'{expected_version}'" {release}/apps/server/dist/app.js
test -f {release}/.runtime/release-schema-check.sql
runuser -u postgres -- psql -X -p 5433 -d za_spa_saas -v ON_ERROR_STOP=1 < {release}/.runtime/release-schema-check.sql
previous=$(readlink /opt/za-spa-saas/current || true)
rollback() {{
 systemctl stop za-spa-saas.service || true
 if test -n "$previous"; then
  if test "$(runuser -u postgres -- psql -X -p 5433 -d za_spa_saas -Atc 'SELECT count(*) FROM staff_store_grants WHERE pages IS NOT NULL OR actions IS NOT NULL')" -gt 0 && ! grep -q 'g.pages,g.actions' "$previous/apps/server/dist/access.js"; then
   echo 'Rollback refused: older API cannot enforce personal employee permissions' >&2
   return 1
  fi
  ln -sfn "$previous" /opt/za-spa-saas/current; systemctl start za-spa-saas.service
 fi
}}
trap rollback ERR
chmod -R go-w {release}
ln -sfn {release} /opt/za-spa-saas/current
install -m 644 /opt/za-spa-saas/za-spa-saas.service /etc/systemd/system/za-spa-saas.service
systemctl daemon-reload
systemctl restart za-spa-saas.service
for attempt in $(seq 1 20); do if curl -fsS --max-time 3 http://127.0.0.1:8791/ready >/dev/null; then break; fi; sleep 1; done
curl -fsS --max-time 10 http://127.0.0.1:8791/ready
test "$(systemctl is-active zuyu || true)" = "$legacy_before"
if test "$legacy_before" = active; then curl -fsS --max-time 10 http://127.0.0.1:8787/ready; fi
systemctl enable za-spa-saas.service
systemctl show za-spa-saas.service -p MemoryCurrent -p MemoryMax -p CPUQuotaPerSecUSec -p ActiveState
trap - ERR
'''
 _,out,err=c.exec_command('bash -se',timeout=120);out.channel.sendall(script.encode());out.channel.shutdown_write()
 for line in out:print(line,end='',flush=True)
 status=out.channel.recv_exit_status()
 if status:print(err.read().decode(),file=sys.stderr)
 raise SystemExit(status)
finally:c.close()



