# ZA Thera｜澜序 V1.0.18

2026-09-18 已发布 API、Web、Windows stable 与 rc 更新渠道。包含房态计时与待办、排钟追溯、细分权限、设备配置步骤及多端冲突处理、原始流水和交班现金差异。详细功能验收见 OPERATIONS-OPTIMIZATION-2026-09-18.md。

发布门禁：类型检查、50项核心测试、30项网关测试通过，无失败或跳过；Web、服务端、Electron及安装包构建成功，31个包内文件与构建一致。此前本轮6个界面用例及16项设备安全测试通过。

发布目录 `/opt/za-spa-saas/releases/20260918T071922Z`，前版本 `/opt/za-spa-saas/releases/20260918-v1.0.17` 保留。生产35项迁移只读检查通过，无新增迁移。发布前备份 `/opt/za-spa-saas/backups/pre-1.0.18.dump` 已经 pg_restore --list 校验，未执行完整恢复。服务配额保持768MiB、60% CPU；旧zuyu服务发布前后均inactive，未启停。

公网商家登录页、平台登录通过，无页面错误；API ready及后台任务健康，Nginx检查通过。公网入口脚本与本地Web构建哈希一致。stable/latest.yml、rc/rc.yml均为1.0.18，清单SHA512与安装包一致，固定下载入口大小正确，公网完整下载SHA256与本地一致。

安装包：ZA-Thera-1.0.18-Windows-x64.exe，112980250字节。
SHA256：`64006d30607d93f2b209ac928721f08c18de154a4eb9c21cb13d02f8cfaf6ceb`。

回滚：保留前发布目录、两个渠道pre-1.0.18.yml及旧安装包；可恢复current与渠道清单及下载别名。已安装新版不会自动降级。

边界：安装包未签名；此次未重新实测交互安装或客户端自动升级安装过程。真实点钟王、刷牌器与报钟器仍需现场协议与业务验收，没有开放未经验证的硬件写入。

日志：.runtime/release-1.0.18-{stage,activate,publish,public,web-smoke}.log。
