"""No customer data or credentials in the operator health report."""
import datetime, json, os, shutil, time
from pathlib import Path
base=Path('/opt/za-spa-saas/backups')
state=Path('/opt/za-spa-saas/health');state.mkdir(mode=0o755,exist_ok=True)
usage=shutil.disk_usage(base)
files=[p for p in base.glob('za_spa_saas-*.dump') if not p.is_symlink() and p.with_suffix('.json').is_file()]
latest=max((p.stat().st_mtime for p in files),default=0)
problems=[]
if usage.free<3*1024**3 or usage.free/usage.total<0.15:problems.append('DISK_SPACE_LOW')
if not latest or time.time()-latest>26*3600:problems.append('BACKUP_STALE')
report={'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'healthy':not problems,'problems':problems,'disk_free_bytes':usage.free,'latest_backup_at':datetime.datetime.fromtimestamp(latest,datetime.timezone.utc).isoformat() if latest else None}
temporary=state/'backup.json.part';temporary.write_text(json.dumps(report),encoding='utf8');os.chmod(temporary,0o644);temporary.replace(state/'backup.json')
print(json.dumps(report));raise SystemExit(1 if problems else 0)
