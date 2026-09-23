# SQL-first migrations

M0 建立本地数据库角色；M1 的 `0001`/`0002` 建立用户、外部身份映射、Workspace、成员关系、RLS 与原子创建/身份解析函数。`pnpm migrate` 使用 migration_role 记录文件 SHA-256 并拒绝已应用文件的内容漂移。正常 API 流量只使用 application_role；请求先验证会话，再在单个数据库事务中用 `SET LOCAL` 设置 AYRA 用户 ID。`pnpm test:integration` 和 `pnpm test:api` 在运行中的 PostgreSQL 上验证跨工作区隔离。生产迁移、扩展/切换/收缩流程尚未验收。
