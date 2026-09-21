"""Loopback-only SSH tunnel to the new PostgreSQL instance.

默认走 paramiko（remote.connect）。若本机无法导入 paramiko（例如 vendored
cryptography 缺少 _cffi_backend），自动回退到系统 ssh 子进程做等价端口转发，
避免隧道建不起来时测试进程在库不可达的情况下静默空转。回退复用 remote.py 的
同一套环境变量与默认值（SAAS_HOST / SAAS_SSH_KEY），转发目标恒为
127.0.0.1:15433 → 远端 127.0.0.1:5433。回退路径启用 ServerAliveInterval
保活，避免空闲掉线。
"""
import os,sys,signal,socketserver,select,subprocess
try:
 from remote import connect
except ImportError:
 connect=None
if connect is not None:
 c=connect()
 c.get_transport().set_keepalive(20)
 class Handler(socketserver.BaseRequestHandler):
  def handle(self):
   channel=c.get_transport().open_channel('direct-tcpip',('127.0.0.1',5433),self.request.getpeername())
   try:
    while True:
     ready,_,_=select.select([self.request,channel],[],[],30)
     for source in ready:
      data=source.recv(65536)
      if not data:return
      (channel if source is self.request else self.request).sendall(data)
   finally:channel.close()
 class Server(socketserver.ThreadingTCPServer):
  allow_reuse_address=True
  daemon_threads=True
 try:
  with Server(('127.0.0.1',15433),Handler) as server:
   print('SaaS PostgreSQL tunnel listening on 127.0.0.1:15433',flush=True);server.serve_forever()
 finally:c.close()
else:
 # paramiko 不可用：回退到系统 ssh 子进程做等价端口转发（-N 只转发、不执行命令）
 child=subprocess.Popen(['ssh','-i',os.environ.get('SAAS_SSH_KEY','C:/Users/Zephael/.ssh/hanjiang-deploy.pem'),'-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','StrictHostKeyChecking=accept-new','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=6','-N','-L','127.0.0.1:15433:127.0.0.1:5433','root@'+os.environ.get('SAAS_HOST','139.196.162.194')])
 def _stop(signum,frame):
  try:child.terminate()
  except Exception:pass
  try:child.wait(timeout=10)
  except Exception:
   try:child.kill()
   except Exception:pass
  sys.exit(0)
 signal.signal(signal.SIGINT,_stop);signal.signal(signal.SIGTERM,_stop)
 print('SaaS PostgreSQL tunnel listening on 127.0.0.1:15433',flush=True)
 sys.exit(child.wait())
