"""Provision ONLY new SaaS roles/databases. Random credentials stay in ignored private files."""
import json,secrets,shlex
from pathlib import Path
from remote import connect

root=Path(__file__).resolve().parents[1]
private=root/'.runtime';private.mkdir(exist_ok=True)
credentials=private/'database-credentials.json'
if credentials.exists():
 raise SystemExit('Credentials already exist; inspect state instead of reprovisioning')
passwords={r:secrets.token_hex(32) for r in ['saas_migrator','saas_app','saas_control','saas_test_app','saas_test_control']}
credentials.write_text(json.dumps(passwords),encoding='utf8')
c=connect()
try:
 sql="CREATE ROLE saas_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;\nCREATE ROLE saas_platform NOLOGIN NOSUPERUSER NOBYPASSRLS;\n"
 for role,password in passwords.items():
  sql+=f"CREATE ROLE {role} LOGIN PASSWORD '{password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;\n"
 sql+="GRANT saas_runtime TO saas_app,saas_test_app;\nGRANT saas_platform TO saas_control,saas_test_control;\n"
 for db,app,control in [('za_spa_saas','saas_app','saas_control'),('za_spa_saas_test','saas_test_app','saas_test_control')]:
  sql+=f"CREATE DATABASE {db} OWNER saas_migrator;\nREVOKE ALL ON DATABASE {db} FROM PUBLIC;\nGRANT CONNECT ON DATABASE {db} TO {app},{control};\n"
 channel=c.get_transport().open_session();channel.exec_command('runuser -u postgres -- psql -X -p 5433 -v ON_ERROR_STOP=1 -q')
 channel.sendall(sql.encode());channel.shutdown_write()
 error=channel.makefile_stderr().read().decode()
 code=channel.recv_exit_status()
 if code: raise RuntimeError('Database bootstrap failed; inspect private credentials and server role state. '+error)
 for label,db,app,control in [('production','za_spa_saas','saas_app','saas_control'),('test','za_spa_saas_test','saas_test_app','saas_test_control')]:
  def url(role,port):return f'postgresql://{role}:{passwords[role]}@127.0.0.1:{port}/{db}'
  jwt=secrets.token_hex(48);platform_jwt=secrets.token_hex(48);encryption=secrets.token_hex(32)
  def environment(port):return '\n'.join([f'DATABASE_URL={url(app,port)}',f'PLATFORM_DATABASE_URL={url(control,port)}',f'MERCHANT_JWT_SECRET={jwt}',f'PLATFORM_JWT_SECRET={platform_jwt}',f'AUTH_ENCRYPTION_KEY={encryption}',f'NODE_ENV={"production" if label=="production" else "test"}',f'PORT={8791 if label=="production" else 8792}','PUBLIC_ORIGIN=https://saas.zephael.cn',''])
  (private/f'{label}.env').write_text(environment(15433)+f'MIGRATION_DATABASE_URL={url("saas_migrator",15433)}\n',encoding='utf8')
  if label=='production':
   sftp=c.open_sftp()
   with sftp.file('/opt/za-spa-saas/production.env','w') as f:f.write(environment(5433))
   sftp.chmod('/opt/za-spa-saas/production.env',0o600);sftp.close()
 print('Created isolated production/test databases and non-privileged login roles. No business rows inserted.')
finally:c.close()
