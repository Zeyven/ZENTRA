set -eu
date -u +'%Y-%m-%dT%H:%M:%SZ'
systemctl is-active zuyu
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8787/ready
systemctl show zuyu -p MemoryCurrent -p CPUUsageNSec
systemctl show postgresql@16-za_saas -p ActiveState -p MemoryCurrent -p MemoryMax -p CPUQuotaPerSecUSec
df -h /opt
free -m
