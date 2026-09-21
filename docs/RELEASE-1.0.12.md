# ZA Thera｜澜序 1.0.12

2026-09-15，发布 API、Web 与 Windows 客户端 1.0.12。Windows 稳定与候选更新通道均已切换到 `ZA-Thera-1.0.12-Windows-x64.exe`；Web 静态资源与 API 同步发布。

- 同一商家内一个房间只能绑定一个设备网关。创建时先检查已存在授权，再检查房间占用；数据库迁移 `035-hardware-binding-room-uniqueness.sql` 以唯一索引防止并发绕过。
- 点钟王 `SystemClockInfo` 的响应字段仍无实机厂商证据，网关继续明确拒绝推测数据，不会把未验证房态当成成功推送给面板。
- 发布前备份：`/opt/za-spa-saas/backups/pre-1.0.12.dump`，已通过 `pg_restore --list` 可读性校验。API 发布目录为`/opt/za-spa-saas/releases/20260915T075250Z`；Web 同步发布目录为`/opt/za-spa-saas/releases/20260915T084659Z`；前版本目录保留。
- 验证：TypeScript 类型检查通过；硬件协议独立测试 22/22 通过；隔离 PostgreSQL 硬件网关用例通过；生产 `/ready` 与公开 `/ready` 均返回 API `1.0.12`，后台任务健康。公开首页引用的 `index-GkXSmEv-.js` 已与本次构建 SHA-256 一致；stable 与 rc 更新元数据都返回 Windows `1.0.12`。
- Windows 包：`ZA-Thera-1.0.12-Windows-x64.exe`，112,976,162 字节，SHA-256 为 `da9d78509ae09b41a983268fd016c98353c880bd64675ea5c5658348096aa586`。安装包内 31 个受检文件、产品名称、版本、图标与更新元数据均已校验；尚未在本轮再次执行真实 Windows 升级安装。

回滚可切回前一发布目录并重启 API。迁移 035 是仅新增唯一索引的保护性约束，不会删除数据；如需回滚代码，保留该约束即可。
