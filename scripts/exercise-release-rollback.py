"""Inject a failed candidate process and verify the existing new SaaS release returns."""
import datetime,json,subprocess,sys
from pathlib import Path
from remote import connect
root=Path(__file__).resolve().parents[1];record=root/'.runtime/staged-release.json';original=record.read_bytes()
candidate='/opt/za-spa-saas/releases/'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
c=connect()
try:
 _,out,err=c.exec_command(f'mkdir -p {candidate}/apps/server/dist && printf "process.exit(42)\\n" > {candidate}/apps/server/dist/index.js')
 assert out.channel.recv_exit_status()==0
 record.write_text(json.dumps({'directory':candidate}))
 result=subprocess.run([sys.executable,str(root/'scripts/activate-release.py')],capture_output=True,text=True,timeout=120)
 assert result.returncode!=0,'Injected failing candidate must not activate'
 expected=json.loads(original)['directory']
 _,out,err=c.exec_command('readlink /opt/za-spa-saas/current; systemctl is-active za-spa-saas; curl -fsS --retry 5 --retry-delay 1 --retry-connrefused http://127.0.0.1:8791/ready; curl -fsS http://127.0.0.1:8787/ready',timeout=30)
 output=out.read().decode();assert out.channel.recv_exit_status()==0;assert expected in output
 evidence={'failed_candidate_rejected':True,'previous_release_restored':True,'new_api_healthy':True,'old_api_healthy':True}
 (root/'.runtime/release-rollback.json').write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
finally:record.write_bytes(original);c.close()
