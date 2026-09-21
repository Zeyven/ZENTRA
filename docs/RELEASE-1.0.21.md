# ZA Thera｜澜序 V1.0.21 发布记录

2026-09-21 发布云端 API、Web、Windows stable/rc 更新渠道。

## 验证结果

- 类型检查及构建通过；53 项核心回归、30 项网关测试、2 项 Node 发布安全测试、5 项 Python 发布流程测试通过。
- 生产备份 za_spa_saas-20260921T063912Z-3b687ff6.dump，SHA-256 7d1ec2a5d2c4ecfb895ad1fd6363a4b8aa20a607136d1e71e7e4a24dd60749c7；临时库恢复与一致性快照比对 88 张表通过。
- 41 项已有迁移结构检查通过，本轮未新增数据库迁移。
- 当前 release：/opt/za-spa-saas/releases/20260921T063527Z；上一 release：/opt/za-spa-saas/releases/20260918T094229Z。
- API /ready 版本 1.0.21，后台任务无错误；备份和恢复 timer active，旧 zuyu 保持 inactive。
- 公网 Web 入口 /assets/index-yCnwVpYs.js 哈希匹配本地；商家登录页、平台登录通过，无页面异常。
- 平台六页面在 1050/390 宽度下滚动检查、密码显隐、记住账号通过；该历史验收脚本报告有写死的 version:1.0.1 字段，不能作为版本证据，实际版本由 /ready 和构建哈希确认。
- stable/latest.yml、rc/rc.yml、固定下载入口以及完整公网安装包 SHA 校验通过。

## 安装包与签名例外

文件 ZA-Thera-1.0.21-Windows-x64.exe，112984500 字节。
SHA-256：ad37c72fdfbf292424e1d3af05fd7abda61e8bd7d9e5c28d4f6850c4f040bb13。
构建指纹：1980e32658e146dacf548ee9f00a198ee8abe0edfbe3faafd890ea634ec12083。
签名状态 NotSigned；用户于本轮明确回复“本次同意未签名推送并留痕”。例外已记录 .runtime/unsigned-release-exceptions.jsonl，发布进程退出后清除例外环境变量。
首次签名检查因 PowerShell 模块路径冲突停止，未上传；限定该进程 PSModulePath 为 WindowsPowerShell 系统模块目录后真实签名查询成功，未修改签名校验逻辑。

## 本机升级：部分通过，安装目录问题待核查

已实际观察旧版 1.0.20 自动发现 1.0.21，经客户端“下载更新”到“更新已下载”，执行“重启并安装更新”后新进程启动。
但新进程来自 C:/Users/Zephael/AppData/Local/Programs/ZA-Thera/ZA-Thera.exe，文件版本 1.0.21.0；原运行路径 D:/ZAThera/ZA-Thera/ZA-Thera.exe 仍是 1.0.20.0。
因此不能声称原安装目录已原位升级：需继续核查自定义安装路径、注册表安装记录及快捷方式。本机未登录商家，未验证已登录会话或营业数据在升级后的业务行为。未对门店设备进行实机验收。

## 发布顺序与回滚

本次在完成公网发布后执行实际客户端更新验收，因此没有满足先完成专用电脑升级验收再推送的推荐顺序；上述路径差异必须保留在交付限制中。
上一渠道清单保存在 pre-1.0.21.yml。恢复旧清单不会使已安装客户端自动降级；不得通过整库还原回滚代码。旧版本目录和备份均保留。
