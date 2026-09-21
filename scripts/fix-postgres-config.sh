set -eu
python3 - <<'PY'
from pathlib import Path
import re
p=Path('/etc/postgresql/16/za_saas/postgresql.conf')
s=p.read_text()
for key,value in [('listen_addresses',"'127.0.0.1'"),('timezone',"'Asia/Shanghai'")]:
 s,count=re.subn(r'^'+key+r'\s*=.*$',key+' = '+value,s,flags=re.M)
 assert count==1,(key,count)
p.write_text(s)
PY
runuser -u postgres -- /usr/lib/postgresql/16/bin/postgres -D /opt/za-spa-saas/postgres -c config_file=/etc/postgresql/16/za_saas/postgresql.conf -C listen_addresses
systemctl start postgresql@16-za_saas
runuser -u postgres -- psql -p 5433 -X -v ON_ERROR_STOP=1 -Atqc 'SELECT version()'
systemctl show postgresql@16-za_saas -p MemoryMax -p CPUQuotaPerSecUSec
systemctl is-active zuyu
curl -fsS --max-time 10 -o /dev/null -w 'Old web HTTP %{http_code}\n' http://127.0.0.1:8787/
