# 自动更新提醒 · 1.0.0-rc.3

## 行为

- Windows 正式客户端启动 15 秒后自动检查；之后每 15 分钟检查一次。发现新版后主动显示非模态提醒；确认下载后显示进度，下载完成后提示重启安装。不开启自动下载、退出时自动安装或降级。
- 自动和手动检查共享进行中的任务；下载中、下载完成待安装和安装中不发起新的检查，避免覆盖待安装状态。
- 桌面提醒选择“本次忽略”后，同一版本、同一状态在当前进程不重复提醒；再次启动或下载完成的新状态可以再次提示。
- Web 商家端和平台管理每分钟读取当前发布 HTML 中的入口资源版本，检测同版本号下的构建变化。仅提示刷新，刷新前二次确认，忽略不会清空表单。
- 网络异常不弹窗打断业务，后续定时重试；页面隐藏时暂停 Web 检查。
- 这是定时检测后主动提醒，不是服务端即时广播。首次需要将 rc.1/rc.2 客户端通过原有手动更新入口升至 rc.3；旧网页需首次刷新加载提醒代码。

## 验证

- 更新控制与桌面隔离单元测试 4/4：并发检查合并、下载状态保护、显式安装、断网恢复和定时器清理。
- Web / Electron 6/6：未来发布清单和桥状态采用受控测试输入验证提醒；原有真实桌面登录收银和平台六工作区回归通过。
- 未来发布测试未向正式渠道发布虚构版本，也未自动执行下载/安装。
- 类型检查、服务端、Web、Electron 和 NSIS 构建通过；29 个包内资源、图标、更新清单与安装器哈希一致。
- 自动审批拦截执行 NSIS 并启动调试的组合验证，原因仅为 blocked by policy；本版安装后自动检查未实测，不沿用 rc.2 的安装结论。
- 正式云端登录及六工作区验证通过，新旧服务健康。Windows 安装包未签名。

安装包：112,946,730 字节；SHA-256 `75469bb6c505ad5127ee850e3824c8c568a76b9ce1731622ab5c7224d9995814`。

## 代码签名门禁（发布必需）

- 为什么：`electron-updater` 在 `publisherName` 为空时会**跳过更新包的签名校验**。`latest.yml` 中的 `sha512` 只能防下载损坏或中间人，防不住更新源本身被篡改——清单与安装包来自同一个源，信任只建立在 TLS 上。因此“发布未签名安装包”必须变成硬性失败，而不是静默缺口。
- 需要购买什么：Windows 代码签名证书（OV 或 EV，正式对外发布通常要求 EV），或改用 Azure Trusted Signing。自签名证书不被 `electron-updater` 与终端用户信任，不能用于正式发布。
- 拿到证书后要改的两个配置项（`apps/client/electron-builder.yml`）：
  - `win.publisherName`：填写证书 Subject 中的组织名（更新校验以此为准）。
  - 顶层 `forceCodeSigning: true`：证书就绪后启用，未签名则打包直接失败。
  两项目前以**注释形式**保留在该文件 `win:` 节点附近；签名材料通过环境变量 `CSC_LINK` / `CSC_KEY_PASSWORD`（或 `win.certificateFile` / `win.certificatePassword`；Azure Trusted Signing 用 `azureSignOptions`）提供，不要提交进仓库。
- 发布门禁：`scripts/publish-update.py` 在上传前默认调用 `scripts/verify-code-signing.mjs`，对 `.exe` 做 Authenticode 校验；未签名或发布者不匹配即中止（非零退出）。可手动执行：`node scripts/verify-code-signing.mjs apps/client/release/ZA-Thera-<版本>-Windows-x64.exe [--publisher <名称>]`。
- 跳过（仅限内测/离线）：显式设置环境变量 `ZA_ALLOW_UNSIGNED=1`（或直接给校验脚本传 `--allow-unsigned`）。正式发布不得使用该开关。
