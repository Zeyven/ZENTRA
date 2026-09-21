"""Stage a reviewed build in a new release directory; never switch the live entry."""
import datetime,hashlib,json,tarfile,shlex,sys,subprocess,os
from pathlib import Path
from release_build import verify,node
root=Path(__file__).resolve().parents[1]
staged=root/'.runtime/staged-release.json'
staged.unlink(missing_ok=True)
from remote import connect
build_digest=verify()
node_exe=str(node())
os.environ['PATH']=str(Path(node_exe).parent)+os.pathsep+os.environ.get('PATH','')
npm=[node_exe,str(Path(node_exe).parent/'node_modules/npm/bin/npm-cli.js')]
# Fail before upload; unavailable test infrastructure is not a passing gate.
subprocess.run([node_exe,'--env-file=.runtime/test.env','scripts/check-test-database.mjs'],check=True,cwd=root)
subprocess.run([node_exe,'--test','tests/release-safety.test.mjs'],check=True,cwd=root)
subprocess.run([sys.executable,'tests/test_release_build.py'],check=True,cwd=root)
subprocess.run([*npm,'run','typecheck'],check=True,cwd=root)
subprocess.run([*npm,'run','test:core'],check=True,cwd=root)
subprocess.run([node_exe,'--test',*[str(p) for p in sorted((root/'tools/hardware-gateway').glob('*.test.mjs'))]],check=True,cwd=root)
subprocess.run([node_exe,str(root/'scripts/release-schema-check.mjs')],check=True,cwd=root)
release=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
archive=root/'.runtime'/f'release-{release}.tar.gz'
files=[root/'package.json',root/'package-lock.json',root/'apps/server/package.json',root/'apps/client/package.json',root/'packages/contracts/package.json',root/'.runtime/release-schema-check.sql']
for folder in ['apps/server/dist','packages/contracts/dist','apps/client/out/web']:
 files.extend(p for p in (root/folder).rglob('*') if p.is_file() and not p.name.endswith('.map'))
assert len(files)>50
with tarfile.open(archive,'w:gz') as tar:
 for path in files:tar.add(path,arcname=path.relative_to(root).as_posix(),recursive=False)
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
if verify()!=build_digest:raise RuntimeError('Build changed during release staging')
record={'release':release,'sha256':digest,'files':len(files),'directory':f'/opt/za-spa-saas/releases/{release}','build_sha256':build_digest,'version':json.loads((root/'package.json').read_text())['version'],'status':'ready'}
c=connect()
try:
 remote_archive=f'/opt/za-spa-saas/releases/{archive.name}'
 s=c.open_sftp();s.put(str(archive),remote_archive);s.close()
 script=f'''set -eu
legacy_before=$(systemctl is-active zuyu || true)
if test "$legacy_before" = active; then curl -fsS --max-time 10 http://127.0.0.1:8787/ready >/dev/null; fi
echo '{digest}  {remote_archive}' | sha256sum -c -
mkdir {record['directory']}
tar -xzf {remote_archive} -C {record['directory']}
cd {record['directory']}
export PATH=/opt/za-spa-saas/runtime/node-v24.19.0-linux-x64/bin:$PATH
systemd-run --quiet --wait --pipe --collect -p CPUQuota=10% -p MemoryMax=512M --working-directory={record['directory']} /usr/bin/env PATH="$PATH" npm ci --omit=dev --ignore-scripts --workspace=@za-spa/server --include-workspace-root=false --no-audit --no-fund
test "$(systemctl is-active zuyu || true)" = "$legacy_before"
if test "$legacy_before" = active; then curl -fsS --max-time 10 http://127.0.0.1:8787/ready; fi
'''
 _,out,err=c.exec_command('bash -se',timeout=900);out.channel.sendall(script.encode());out.channel.shutdown_write()
 for line in out:print(line,end='',flush=True)
 status=out.channel.recv_exit_status()
 if status:print(err.read().decode(),file=sys.stderr);raise SystemExit(status)
 if verify()!=build_digest:raise RuntimeError('Build changed during upload; release not ready')
 temporary=staged.with_suffix('.tmp');temporary.write_text(json.dumps(record,indent=2));temporary.replace(staged)
 print(json.dumps(record))
finally:c.close()
