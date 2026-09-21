"""Encrypted independent recovery kit. Never print or copy old system secrets."""
import json,secrets,datetime,hashlib
from pathlib import Path
from remote import connect
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
root=Path(__file__).resolve().parents[1];private=root/'.runtime';c=connect()
try:
 s=c.open_sftp()
 with s.file('/opt/za-spa-saas/production.env','r') as f:environment=f.read().decode()
 assert 'NODE_ENV=production' in environment and '/za_spa_saas\n' in environment
 payload=json.dumps({'version':1,'environment':environment,'roles':json.loads((private/'database-credentials.json').read_text(encoding='utf-8')),'platform_account':json.loads((private/'production-platform-account.json').read_text(encoding='utf-8'))}).encode()
 key=secrets.token_bytes(32);nonce=secrets.token_bytes(12);encrypted=nonce+AESGCM(key).encrypt(nonce,payload,b'za-spa-saas-recovery:v1')
 key_path=private/'production-recovery.key';archive=private/'production-recovery.enc'
 with key_path.open('xb') as f:f.write(key)
 with archive.open('xb') as f:f.write(encrypted)
 assert AESGCM(key).decrypt(encrypted[:12],encrypted[12:],b'za-spa-saas-recovery:v1')==payload
 name='recovery-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.enc'
 s.put(str(archive),'/opt/za-spa-saas/backups/'+name);s.chmod('/opt/za-spa-saas/backups/'+name,0o600);s.close()
 print(json.dumps({'encrypted_recovery_created':True,'round_trip_verified':True,'sha256':hashlib.sha256(encrypted).hexdigest(),'decryption_key_uploaded':False}))
finally:c.close()
