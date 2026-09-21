# ZA Thera｜澜序 V1.0.19

2026-09-18发布API、Web、Windows stable/rc渠道。手牌管理改为添加和物理删除，取消恢复入口；删除释放编号和芯片卡号，未结账或挂单拒绝删除，历史订单快照和操作审计保留。旧停用档案可见并可逐条删除，无自动清理现有数据。批量添加原子提交、输入去重、已存在跳过计数、冲突具体提示、未知结果用原请求核对。

发布门禁：类型检查、53项核心回归、30项网关测试通过，无失败或跳过。此前针对本次改动的3项API测试及1项浏览器弱网重试测试通过。API/Web/Electron及安装包构建通过，31个包内文件一致。

生产应用036-wristband-delete.sql，只授予saas_runtime手牌DELETE权限；强制RLS仍启用。切换前36项迁移检查通过。备份 `/opt/za-spa-saas/backups/pre-1.0.19.dump` 的pg_restore --list通过，未完整恢复演练。

发布目录 `/opt/za-spa-saas/releases/20260918T075229Z`，前版本 `/opt/za-spa-saas/releases/20260918T071922Z` 保留；stable及rc的pre-1.0.19.yml保留。服务失败可切回前版本，代码回滚不恢复已删除档案。运行配额保持768MiB与60% CPU，旧zuyu服务仍inactive且未启停。

公网API、后台任务、商家登录页、平台登录、Web入口哈希通过；stable/latest.yml和rc/rc.yml均为1.0.19，SHA512与本地安装包一致。公网完整下载与本地SHA256一致，固定下载入口正常。

安装包ZA-Thera-1.0.19-Windows-x64.exe，112980244字节；SHA256：`2a5663b5fd5bf6a3be3c7a99c63cb0a3445f4300e44a9f8054bc6ec65eefcd01`。

本次未实测交互安装或自动升级安装过程；安装包未签名。未删除任何生产手牌作为测试。
