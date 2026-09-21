"""Isolated test API on the production host, under the agreed resource caps."""
import json,re,sys
from pathlib import Path
from remote import connect
root=Path(__file__).resolve().parents[1]
release=json.loads((root/'.runtime/staged-release.json').read_text())['directory']
assert re.fullmatch(r'/opt/za-spa-saas/releases/\d{8}T\d{6}Z',release)
environment='\n'.join(line.replace(':15433/',':5433/') for line in (root/'.runtime/test.env').read_text().splitlines() if line and not line.startswith(('MIGRATION_DATABASE_URL=','PORT=','PUBLIC_ORIGIN=')))
assert 'NODE_ENV=test' in environment and '/za_spa_saas_test' in environment
environment+='\nPORT=8794\nPUBLIC_ORIGIN=http://127.0.0.1:8794\nSAAS_TEST_JOBS=1\n'
c=connect()
try:
 s=c.open_sftp();s.put(str(root/'scripts/acceptance-load.mjs'),release+'/acceptance-load.mjs')
 with s.file('/opt/za-spa-saas/operator/acceptance.env','w') as f:f.write(environment)
 s.chmod('/opt/za-spa-saas/operator/acceptance.env',0o600);s.close()
 script=f'''set -eu
test "$(systemctl is-active zuyu)" = active
test "$(systemctl is-active za-spa-saas-acceptance.service || true)" != active
trap 'systemctl stop za-spa-saas-acceptance.service || true' EXIT
systemd-run --quiet --unit=za-spa-saas-acceptance --collect -p User=za-spa-saas -p Group=za-spa-saas -p MemoryMax=768M -p CPUQuota=60% -p NoNewPrivileges=true -p ProtectSystem=strict -p EnvironmentFile=/opt/za-spa-saas/operator/acceptance.env --working-directory={release} /opt/za-spa-saas/runtime/node-v24.19.0-linux-x64/bin/node apps/server/dist/index.js
for i in $(seq 1 20); do if curl -fsS --max-time 3 http://127.0.0.1:8794/ready >/dev/null; then break; fi; sleep 1; done
curl -fsS --max-time 10 http://127.0.0.1:8794/ready >/dev/null
/opt/za-spa-saas/runtime/node-v24.19.0-linux-x64/bin/node --env-file=/opt/za-spa-saas/operator/acceptance.env {release}/acceptance-load.mjs
systemctl show za-spa-saas-acceptance.service -p MemoryPeak -p MemoryMax -p CPUQuotaPerSecUSec
systemctl show postgresql@16-za_saas.service -p MemoryCurrent -p MemoryMax -p CPUQuotaPerSecUSec
curl -fsS --max-time 10 http://127.0.0.1:8787/ready
'''
 _,out,err=c.exec_command('bash -se',timeout=900);out.channel.sendall(script.encode());out.channel.shutdown_write()
 for line in out:print(line,end='',flush=True)
 status=out.channel.recv_exit_status()
 if status:print(err.read().decode(),file=sys.stderr)
 s=c.open_sftp()
 try:s.get('/opt/za-spa-saas/operator/capacity-result.json',str(root/'.runtime/capacity-result.json'))
 except FileNotFoundError:pass
 s.close();raise SystemExit(status)
finally:c.close()
