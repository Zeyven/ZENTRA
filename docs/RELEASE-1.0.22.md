# V1.0.22 升级目录修复记录

2026-09-21。代码已构建，云端、Windows stable/rc 更新渠道及本机软件内升级验收均已完成。

## 原因与改动

旧客户端调用 quitAndInstall 时没有设置 NsisUpdater.installDirectory。安装器依赖注册表 InstallLocation 或默认目录。此前从 D 盘运行的 1.0.20 更新后在 C 盘启动 1.0.21；升级前注册表值没有留存，因此无法确定当时是记录缺失还是已有错误值。

新版本在打包的 Windows 客户端启动时，将 installDirectory 设为 app.getPath('exe') 的父目录。目录来源于当前进程，不接受渲染器传入路径；开发模式不设置。真实 electron-updater 6.8.9 的 doInstall 调用测试确认 /D= 参数完整传入含中文和空格的自定义目录。

## 验证

- 自动更新控制器及实际 NSIS 参数回归 4 项通过。
- typecheck、Web/Electron/API 构建及安装包验证通过。
- 发布安全测试 7 项、核心回归 53 项、硬件网关测试 30 项通过。
- 另尝试执行未修改的 test-installer-guard.ps1，系统脚本执行策略拒绝；没有修改执行策略，不能计为本轮通过。真实安装已执行如下。
- 本机使用原发布的 1.0.21 安装器修复到 D:/ZAThera/ZA-Thera；安装器移除 C 盘重复安装，并修复注册表、桌面和开始菜单快捷方式。
- 随后运行真实 1.0.22 安装器，参数 /S --updated --force-run /D=D:\ZAThera\ZA-Thera；退出码 0。原位替换后自动重启，进程来自 D 盘，文件 ProductVersion=1.0.22.0，两处快捷方式和注册表仍指向 D 盘，C 盘无重复 EXE。
- 新客户端房态页面渲染正常，实时连接正常；未创建测试生产订单或修改业务数据。观察期间有用户交互，不能据此声称登录会话自动保留。认证按原设计使用 sessionStorage。
- 上述本机验收为显式传参的实际安装，不等同于 V1.0.22 客户端内检查、下载、安装的完整推送验收。

## 云端

新 release：/opt/za-spa-saas/releases/20260921T074155Z。
上一 release：/opt/za-spa-saas/releases/20260921T063527Z。
/ready 返回 1.0.22、ok=true、jobs.error=null。商家页面及平台登录检查通过。
生产已有 41 项迁移结构检查通过，无新增迁移。
备份 za_spa_saas-20260921T073904Z-bdff5047.dump，SHA-256 51a64501714be6c64391dd810c965ca6b926723775a2976eeff24bcee91aa850；临时恢复一致性比对 88 张表通过。

## 安装包

ZA-Thera-1.0.22-Windows-x64.exe，112984675 字节。
SHA-256 ae29c41a67f1c3a69d0d4f4b776771a1cef69dacf9578ab081687c0755a6231d。
构建指纹 37c6f8eb37a8f25a4c9ec827863454ae74317c4000e22834b6e2a904ce0defe6。
实际签名查询 NotSigned。用户在解释签名例外要求后明确要求完成 V1.0.22 推送，本次按未签名例外发布并留痕。stable/rc 均已更新到 1.0.22；固定下载入口已切换。

已有旧客户端不会获得尚未下载的新版本中的安装路径修复：首次升级前仍需校正其安装记录或手动指定原目录。本机这一处理已完成；不能将本机修复等同于所有门店已升级。

## 软件内升级最终验收（2026-09-21 17:01 后）

为验证实际流程，本机临时使用已发布 1.0.21 安装器建立旧版基线，安装位置仍为 D:/ZAThera/ZA-Thera；未开启线上降级或改变生产数据库。
观察到旧版自动提示发现 1.0.22，登录页已记住的商家和账号保留。用户在本机完成“下载更新”和“重启并安装更新”，并在当前对话明确确认。此验收为用户与代理协作完成，并非全部点击均由代理执行。

更新缓存中的 1.0.22 EXE、current.blockmap 和 update-info.json 于 17:01:37 更新。安装后进程来自 D:/ZAThera/ZA-Thera/ZA-Thera.exe，ProductVersion=1.0.22.0；安装 ASAR SHA-256 A8D98E83E105F1BED7DE22AB679FE1CA53532AB11F41A201047A2595FCC7ADC6，与构建 ASAR 完全一致。注册表、桌面及开始菜单快捷方式均指向 D 盘；C 盘无重复 EXE。

公网验证：/ready 健康版本 1.0.22，Web JS 哈希与构建一致；stable/latest.yml 和 rc/rc.yml 版本、文件名、SHA-512 均一致，完整下载 EXE 的 SHA-256 与本地一致，固定下载入口验证通过。记录见 .runtime/release-1.0.22-public.log、release-1.0.22-publish.log、release-1.0.22-in-app-upgrade.json、unsigned-release-exceptions.jsonl。

本机在已修正安装记录的条件下，从 1.0.21 经软件内更新到 1.0.22 的流程通过。新版本强制使用当前运行目录的参数路径另有真实 NsisUpdater 回归测试；没有通过伪造生产新版本再测试 1.0.22 到未来版本。其他门店仍须实际升级，不代表全部终端已更新。
