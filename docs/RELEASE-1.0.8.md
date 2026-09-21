# V1.0.8 接入配置与诊断发布

2026-09-14，按用户授权发布云端及 Windows 更新。范围为点钟王只读联调网关、技师房播报器配置诊断、过期心跳与撤销授权的历史状态提示。未开放设备登录、报钟写入及远端播报。

发布目录：/opt/za-spa-saas/releases/20260914T083615Z。API V1.0.8 健康、任务正常；旧 zuyu 服务保持发布前 inactive 状态，资源配额仍为 MemoryMax=768 MiB、CPUQuota=60%。

生产新增迁移 032-hardware-gateways.sql，事务提交并启用两张表的强制 RLS。迁移前备份 /opt/za-spa-saas/backups/pre-1.0.8-20260914T083652Z.dump，pg_restore --list 可读；未执行完整恢复演练。迁移仅新增表，程序激活失败回退旧发布不需删除新表。

验证：前一轮 4 项诊断逻辑测试、2 项浏览器回归、类型检查通过；本轮 V1.0.8 server/contracts/Web/Electron 构建及 NSIS 打包成功。31 项包内文件比对、图标和更新摘要通过。上传逐文件 SHA256 校验，最后替换清单。公开 stable/latest.yml 与 rc/rc.yml 均为 1.0.8；版本安装包和 ZA-Thera-Setup.exe 均 HTTP 200、112958894 字节；公开 Web HTML 与构建一致；未认证网关管理请求 401。

安装包 SHA256：eba5a182aee05c3646ff28a6b14c22a5a54b4e2ed0ac4d9efa4237bfb9e95454。

本轮没有重新执行实际安装/升级/卸载，未做真实硬件验收。协议研究、厂家文件和本机模拟器未包含在安装包中。独立只读网关运行工具仍处于单独联调阶段。
