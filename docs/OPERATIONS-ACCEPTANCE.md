# 运行、备份与导出验收

2026-09-08。仍不是完整上线验收完成声明。

## 后台服务

修复任务游标被单一商家异常阻塞的问题。每个商家失败独立记录并继续后续商家；分页完成一轮后重试，健康状态保留未恢复的失败。并发 tick 共享一个执行过程，关闭等待当前任务结束并停止继续取商家。

共享接口包原先直接导出 TypeScript 源文件，普通 Node 导入复现 `ERR_MODULE_NOT_FOUND`。现在通过 TypeScript 编译为 JavaScript，根构建先构建 contracts，再构建 server 和 client。首次安装 prepare、测试前 pretest 都构建 contracts。直接运行测试文件时，修改 contracts 后需先构建它。

`tests/job-runner.test.ts`、`tests/clock-jobs.test.ts`、`tests/server-runtime.test.ts` 共 **5/5 通过**：包含故障注入的调度单测、真实数据库隔离和提醒去重、编译后 Node 服务进程运行真实任务与健康检查。Windows 测试结束时终止子进程不等同于 Linux systemd 的优雅退出验收，后者仍待验证。

## 云端备份

只操作 5433 的新实例，以及明确允许的 `za_spa_saas` / `za_spa_saas_test`；没有旧库或旧配置读取。

- `scripts/saas-backup.py` 使用一致性快照生成 PostgreSQL 16 custom archive，SHA-256 清单，原子发布备份文件。每日备份保留 30 天；只清理本数据库匹配名称的过期备份。
- 先检查剩余磁盘，低于 3 GiB 加预计操作空间，或不足 10%，停止备份/恢复以保护同机旧服务。
- 恢复只创建随机命名的临时数据库，撤销 PUBLIC 连接权；成功与失败都仅清理该临时库，不提供覆盖正式库的开关。
- 从同一备份快照逐表计算内容 SHA-256，临时恢复后逐表对比，同时检查没有未验证约束。备份目录 root 私有，备份数据和认证材料不输出到日志。
- `za-spa-saas-backup.timer` 每日北京时间 03:15 加随机延迟运行备份和临时恢复核对；服务限制 256 MiB / 10% CPU，低 IO 优先级。
- `za-spa-saas-backup-monitor.timer` 每 15 分钟检查磁盘和备份时效，超过 26 小时无备份或磁盘不足时失败；写入不含客户数据和凭据的 `/opt/za-spa-saas/health/backup.json`。平台界面接入该状态仍待完成。

测试库恢复证据：`za_spa_saas_test-20260908T092430Z-e7c1c750.dump`，1,772,193 字节，SHA-256 `7dc476d0e2c1959a3a142953c45265b590060f1dc3e3c686caf860e5347b5a36`；恢复 **80 张表与原快照全部一致**。

09:25 UTC 已确认新正式库为 0 张业务表，完成初始化前备份（`za_spa_saas-20260908T092537Z-2fe4f28b.dump`，SHA-256 `7627783a47606454210ac15d8e2f8ac724393566b4db4b85d536d16aa7b74f67`），随后只对新正式库应用迁移 001–016。没有创建平台管理员、商家或经营数据。生产入口尚未开放。

09:27 UTC 正式备份 service 首次运行 `Result=success / ExecMainStatus=0`，两个 timer 已启用，监测 healthy，剩余约 40.8 GiB；旧 zuyu active、ready 成功。异机恢复及独立密钥恢复操作记录仍需补验。

单商家恢复已在两个临时数据库实际演练：64 张商家业务表按外键顺序恢复，其他商家指纹不变；保留当前账号密码与停用状态，撤销目标商家旧会话，不恢复历史授权。注入会员插入失败后，整个恢复事务回滚，双方数据指纹保持不变。结果为 `other_merchant_unchanged / credentials_preserved / sessions_revoked / failure_atomic = true`。恢复不关闭外键或重置全局序列，先校验归档，再自动备份目标库；仅允许离线运维工具操作停用商家，没有业务端覆盖入口。`tests/restoration-lock.test.ts` 1/1 通过：目标商家事务等待恢复锁，其他商家继续，恢复撤权后旧会话被拒绝。

工具行为参考 [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html) 和 [pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)。

## 商家经营导出

老板可流式导出本商家的经营数据，停用后仍可操作；独立 RLS 快照，分批读取降低 API 内存占用，记录导出审计。员工、平台及支持身份不能使用这个入口，查询参数不能指定其他商家。输出完成标记和 SHA-256 校验，只有完整接收且商家匹配才下载文件。

经营导出使用经审查的数据集列表，排除登录账号、会话和渠道密钥配置，递归剔除业务数据中的 token/secret 等敏感字段；不是可覆盖数据库的备份文件。浏览器目前在下载时组装完整文件，超大商家数据的客户端内存仍需容量验收。

`tests/exports.test.ts` **2/2 通过**：同手机号商家隔离、真实会员和储值记录、凭据排除、停用后导出和写入拒绝、非法身份拒绝。`tests/browser/member-assets.spec.ts` 的导出用例 **1/1 通过**：故意截断真实导出响应时拒绝下载，完整重试后核对导出文件中的落库余额。

## 用户确认的外部接口边界

支付/团购渠道、小票打印机和手牌读卡器等硬件本次只预留接口。配置、隔离和未接入反馈仍需实现并测试；没有真实服务商授权或实体设备不作为本次上线阻碍。不模拟成功，不宣称完成外部联调。


2026-09-08 补验：后端完整回归 104/104 通过（640.2 秒，无跳过，维护日志接入前基线）。之后导出改为一个 UNION ALL 游标分批读取已审查数据集，去除每张空表三次往返；老板导出隔离等后端 2/2 与浏览器截断拒绝及完整校验下载均重新通过。仍保持授权快照、RLS、脱敏、背压和提交后完成标记。

11:15 UTC 旧服务 zuyu active、ready 成功，新 PostgreSQL 约 194 MiB，仍为 1 GiB/60% 配额，磁盘约 41 GiB 可用、13% 已用。该健康检查不等同于 100 台在线设备压测。
