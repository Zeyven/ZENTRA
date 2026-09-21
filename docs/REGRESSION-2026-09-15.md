# 2026-09-15 服务端隔离回归

本轮重跑使用服务器上的独立 `za_spa_saas_test` 数据库，经本机 SSH 端口转发访问；未复制正式业务数据，也未执行正式库迁移。`.runtime/test.env` 的应用和平台测试角色密码已在隔离测试库更新，凭证未打印，旧配置备份及临时修复脚本已删除。测试隧道在结束后关闭。

起初 `coupon-claims`、`owner-invites` 和 `platform-stores` 的失败发生在测试钩子，原因是测试角色密码过期。修复后前两组全部通过。永久删除用例还暴露测试库对象归属与正式库不一致：测试库公共关系 155 个、函数 9 个原本全部由 `postgres` 所有，而正式库当时 153 个关系与 9 个函数由 `saas_migrator` 所有。测试库迁移角色因而不能执行已删除门店的直接更新检查，错误停在函数/表权限而非保护触发器。只在隔离测试库把公共表及函数转为 `saas_migrator` 所有，关联 identity 序列随表一起转移；无效的权限迁移实验已撤回。正式库对象及权限没有更改。

调整后的 `platform-stores` 2 项通过，其中已删除门店直接更新返回保护触发器的 `cannot be changed or restored` 错误。随后完整服务端回归 `node --env-file=.runtime/test.env --import tsx --test --test-reporter=tap --test-concurrency=1 tests/*.test.ts` 以退出码 0 结束：148 项通过、0 失败、0 跳过；完整输出保存于 `.runtime/full-regression-after-test-auth.log`。`npm run build` 同轮通过，覆盖共享合同、服务端与 Web/Electron 构建。

这只证明当前源码在该隔离测试库及这些自动化场景下通过。当前新增点钟王启动菜单校验尚未发布；实机 TCP 登录、菜单业务映射、报钟等写入与钟房播报仍缺现场/厂商协议证据。本轮未生成或推送安装包，也未做云端发布与安装升级复测。

在线只读复核：服务器本机新 API `127.0.0.1:8791/ready` 返回 HTTP 200、版本 1.0.9、后台任务无错误。公网 `/ready` 当前返回 Web 首页，不能当作 API 健康入口。旧 `zuyu` 单元与 8787 监听当前均不存在/未运行；`docs/RELEASE-1.0.9.md` 也记录该单元在发布前已为 inactive，故不能把它作为本次测试导致的退化，但目前同机旧服务健康无法重新验收。

后续同日运维修正：正式库 `hardware_gateways`、`hardware_bindings` 皆为 0 行，虽已启用强制 RLS，却由超级用户 `postgres` 持有；其余业务表和全部 9 个函数由非超级用户 `saas_migrator` 持有。仅调整这两张空表的所有者为 `saas_migrator`，RLS/强制 RLS 与 `saas_app` 读取授权均保持，API 本机 `/ready` 仍为 HTTP 200。该操作没有修改表数据或旧项目。

独立 Nginx 虚拟主机增加精确的 `location = /ready` 转发至 `127.0.0.1:8791`，旧配置保存在 `/etc/nginx/conf.d/za-spa-saas.conf.before-ready-20260915`；`nginx -t` 成功后重载。公网 `https://saas.zephael.cn/ready` 返回 HTTP 200、JSON 中 `service=za-spa-saas`、`version=1.0.9`、`ok=true`；首页仍为 HTTP 200。仓库 `scripts/saas.nginx.conf` 已同步该路由，防止以后部署覆盖。当前客户端与云端业务版本仍为 1.0.9，本轮未发布新业务代码或安装包。

安装复测：本机先保存原 1.0.3 安装目录、HKCU 卸载登记和两条快捷方式，使用隔离目录执行 1.0.9 静默安装与卸载；随后执行 1.0.8 静默安装、同目录覆盖升级到 1.0.9、再卸载。相邻版本复测中三个安装/卸载进程退出码均为 0，1.0.8 和 1.0.9 登记依次正确，1.0.9 安装后的 `app.asar` SHA256 与发布构建一致。结果保存于 `.runtime/install-retest-109-b/result.json` 和 `.runtime/install-retest-108-to-109/result.json`。原 1.0.3 登记、`app.asar`、两条快捷方式的备份哈希以及用户数据 `Preferences` 哈希在最终核对中均保持一致。

第一次复测脚本使用 Windows PowerShell 5，因无 BOM UTF-8 中文路径误读，没有保存快捷方式且在最后一项用户数据核对报错。程序与登记当时已恢复；两条快捷方式从此前 `.runtime/install-retest-rc8/shortcut-*.lnk` 备份恢复，目标均为原 `D:\ZAThera\ZA-Thera\ZA-Thera.exe`。之后改用 PowerShell 7，在复测前验证两条快捷方式确实备份并通过最终哈希核对。第一次失败不计为通过。

上述是安装、覆盖升级及卸载的静默 NSIS 路径；交互式向导、客户端自动检测/下载/提示/重启的实际 OTA 流程仍未完整实机复测。隔离安装目录没有启动客户端，因此也不能宣称店内设备运行验收完成。

公网 stable `latest.yml` 同日返回 HTTP 200、版本 1.0.9、安装包名及大小 112970495 字节；其 SHA512 与本地经安装复测的同版安装包一致。这验证更新清单与安装文件的静态一致性，不等于 Electron 客户端自动更新流程已经跑通。
