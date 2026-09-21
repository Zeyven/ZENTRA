"""Publish verified SaaS artifacts; the update manifest is replaced last."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
from remote import connect
from release_build import verify,node
verify()
root=Path(__file__).resolve().parents[1];verification=json.loads((root/'.runtime/brand-artifact-verification.json').read_text(encoding='utf-8'))
version=json.loads((root/'apps/client/package.json').read_text(encoding='utf-8'))['version']
assert verification['version']==version
names=[f'ZA-Thera-{version}-Windows-x64.exe',f'ZA-Thera-{version}-Windows-x64.exe.blockmap','latest.yml']
assert hashlib.sha256((root/'apps/client/release'/names[0]).read_bytes()).hexdigest()==verification['sha256']
# Refuse to publish an unsigned installer: electron-updater skips update signature checks when publisherName is empty.
publisher=os.environ.get('ZA_PUBLISHER_NAME')
sign=[str(node()),str(root/'scripts/verify-code-signing.mjs'),str(root/'apps/client/release'/names[0])]
if publisher:sign+=['--publisher',publisher]
unsigned_reason=os.environ.get('ZA_UNSIGNED_APPROVAL_REASON','').strip()
if os.environ.get('ZA_ALLOW_UNSIGNED')=='1':
 if len(unsigned_reason)<10:raise RuntimeError('Unsigned exception requires explicit user approval and ZA_UNSIGNED_APPROVAL_REASON (at least 10 characters)')
 sign.append('--allow-unsigned')
subprocess.run(sign,check=True,cwd=root)
if os.environ.get('ZA_ALLOW_UNSIGNED')=='1':
 import datetime
 with (root/'.runtime/unsigned-release-exceptions.jsonl').open('a',encoding='utf-8') as log:
  log.write(json.dumps({'version':version,'sha256':verification['sha256'],'reason':unsigned_reason,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()},ensure_ascii=False)+'\n')
c=connect()
try:
 _,out,err=c.exec_command('install -d -m 755 /opt/za-spa-saas/updates/windows/stable /opt/za-spa-saas/updates/windows/rc');assert out.channel.recv_exit_status()==0
 s=c.open_sftp()
 for channel in ['stable','rc']:
  manifest='/opt/za-spa-saas/updates/windows/'+channel+('/latest.yml' if channel=='stable' else '/rc.yml')
  backup='/opt/za-spa-saas/updates/windows/'+channel+'/pre-'+version+'.yml'
  try:
   s.stat(backup)
  except FileNotFoundError:
   with s.open(manifest,'rb') as source:
    with s.open(backup,'wb') as destination:destination.write(source.read())
  for name in names:
   local=root/'apps/client/release'/name
   remote_name='rc.yml' if channel=='rc' and name=='latest.yml' else name
   target='/opt/za-spa-saas/updates/windows/'+channel+'/'+remote_name
   s.put(str(local),target+'.incoming');s.chmod(target+'.incoming',0o644)
   _,out,err=c.exec_command('sha256sum '+target+'.incoming');actual=out.read().decode().split()[0];assert actual==hashlib.sha256(local.read_bytes()).hexdigest()
   s.posix_rename(target+'.incoming',target)
 # A stable filename keeps the website download entry current without rebuilding Web.
 alias='/opt/za-spa-saas/updates/windows/stable/ZA-Thera-Setup.exe'
 s.symlink(names[0],alias+'.incoming');s.posix_rename(alias+'.incoming',alias)
 s.close();print(json.dumps({'published_version':version,'sha256':verification['sha256'],'manifest_published_last':True}))
finally:c.close()

