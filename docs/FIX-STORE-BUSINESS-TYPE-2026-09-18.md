# 门店业态保存修复

用户报告商家管理的点钟王业态选项无法保存。生产库直接查询确认 stores.point_clock_business_type 不存在；迁移记录已有 034、035，但缺少 033。根因是发布未按迁移名称逐项检查，而仅检查版本数量。OwnerConsole 的异步 onChange 又没有捕获异常，因此界面没有明确反馈。

2026-09-18 已备份生产数据库至 /opt/za-spa-saas/backups/pre-033-fix-20260918.dump，root 执行 pg_restore --list 验证可读。事务内加迁移锁补齐 033 字段、枚举约束和迁移记录。以回滚事务验证目标门店能写入 BATH 和 FOOT，结束后仍保持未配置；该门店有效网关数为零。未改变用户的实际业态选择。

OwnerConsole 增加异常反馈、防重复保存，并保留当前门店；类型检查与 Web 构建通过。Web 热修复已发布，公网入口脚本与本机构建一致，API ready 正常。现有 Windows 客户端立即受益于数据库修复；新增前端反馈暂只发布 Web，未重新打包 Windows。

浏览器读取超时，本次未完成用户登录态的端到端点击验收。保留旧 Web index 于发布目录 index-before-store-type-fix.html。
