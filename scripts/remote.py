"""Operator SSH transport. Credentials remain outside this repository."""
import os,sys,shlex
from pathlib import Path
try:
 import paramiko
except ImportError:
 sys.path.insert(0,'E:/Shipin/.python-deploy')
 import paramiko

def connect():
 c=paramiko.SSHClient();c.load_system_host_keys()
 c.load_host_keys(os.environ.get('SAAS_KNOWN_HOSTS','C:/Users/Zephael/.ssh/known_hosts'))
 c.set_missing_host_key_policy(paramiko.RejectPolicy())
 c.connect(os.environ.get('SAAS_HOST','139.196.162.194'),username='root',pkey=paramiko.RSAKey.from_private_key_file(os.environ.get('SAAS_SSH_KEY','C:/Users/Zephael/.ssh/hanjiang-deploy.pem')),timeout=20)
 return c

if __name__=='__main__':
 c=connect()
 try:
  script=Path(sys.argv[1]).read_text(encoding='utf-8')
  command='bash -se' if sys.argv[1].endswith('.sh') else 'node --input-type=module'
  channel=c.get_transport().open_session();channel.settimeout(600);channel.exec_command(command)
  channel.sendall(script.encode());channel.shutdown_write()
  while True:
   if channel.recv_ready():sys.stdout.write(channel.recv(65536).decode('utf-8','replace'));sys.stdout.flush()
   if channel.recv_stderr_ready():sys.stderr.write(channel.recv_stderr(65536).decode('utf-8','replace'));sys.stderr.flush()
   if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():break
   import select;select.select([channel],[],[],0.2)
  sys.exit(channel.recv_exit_status())
 finally:c.close()
