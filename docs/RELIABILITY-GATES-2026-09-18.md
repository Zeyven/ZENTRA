# 发布检查与操作反馈

本轮目标：阻止遗漏数据库迁移的构建上线，固定核心营业回归入口，避免共享按钮吞掉返回值形式的保存失败。

## 实现

- `npm run check:release-schema` 从仓库全部 SQL 文件生成只读检查，逐项检查 35 个迁移名称；另核对点钟王业态字段、枚举约束和 3 个硬件绑定有效唯一索引。不是完整数据库结构校验或自动迁移工具。
- stage-release.py 上传前执行全项目类型检查、`npm run test:core` 和网关测试，并将生成的检查 SQL 放入发布包。activate-release.py 切换 current 前执行该 SQL，失败即中止，不补写迁移记录。
- 保持旧服务发布前的运行状态；原来 active 时检查健康，原来 inactive 时不启动它。修正构建版本检查对冒号后空白的错误假设。
- `test:core` 固定覆盖 operations、clock-operations、member-assets、operational-permissions、staff-permissions、realtime、store-management、wallet，以及共享按钮返回值检查和发布检查生成器。
- AsyncButton 检查回调返回的 `ok:false`，显示错误；RESULT_UNKNOWN 提示核对原请求，不宣称保存成功。既有防重复点击保留。业务表单仍负责保存原请求、幂等键及未知结果恢复，不能据此声称所有页面已经统一完成。

## 验证

- 23 项核心集成测试及 7 项 wallet 集成测试通过，使用隔离测试数据库。
- 30 项网关测试通过。
- action-result 与 release-schema-check 共 2 项测试通过。
- 全项目类型检查通过，两个 Python 发布脚本通过 AST 语法校验。
- 生成 SQL 在生产库只读执行通过；加入虚构迁移的只读负向实验明确抛出 Missing migrations，未改写生产数据。

本轮未发布云端或安装包。未执行完整发布/回滚演练、浏览器按钮交互、实际安装升级或实机硬件验收。发布仍必须使用标准流程，手工绕过脚本不会自动获得这些保障。
