# 澜序发布与部署执行手册

适用仓库：`E:\Shipin\ZuyuSaaS`；2026-09-21 修订。本手册与 `scripts/` 内持久化工具配套使用。阅读手册不构成执行生产发布或未签名例外的授权。

## 1. 边界

- 不新增 Git remote、不 push；本地提交只包含审查过的代码。
- 不打印、复制生产环境凭据；不将 `.runtime`、私钥或密码提交/打包。
- 不清理生产 releases、backups、operator，不为回滚代码整库恢复生产数据。
- 测试只能使用 `za_spa_saas_test`。网络可达不等于数据库身份正确。
- 不提高宿主删除守卫阈值，不绕过宿主审批。构建被拦截时停止并核对允许的处理方式。
- 不默认启用未签名发布例外；不得把无效签名、未知签名状态当作未签名放行。
- 冻结构建输入。不要与其他代理同时编辑同一工作区的构建输入。

## 2. PowerShell 环境（所有命令在仓库根执行）

```powershell
Set-Location E:\Shipin\ZuyuSaaS
$ErrorActionPreference = 'Stop'
$releaseNode = 'C:\Program Files\nodejs\node.exe'
$releasePython = 'C:\Users\Zephael\.workbuddy\binaries\python\envs\default\Scripts\python.exe'
$env:SAAS_NODE = $releaseNode
$env:PATH = "$(Split-Path $releaseNode);$env:PATH"
$env:PATHEXT = '.COM;.EXE;.BAT;.CMD'
function Invoke-ReleaseStep {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "发布步骤失败，退出码 $LASTEXITCODE，已停止" }
}
Invoke-ReleaseStep -Program $releaseNode -Arguments @('--version')
Invoke-ReleaseStep -Program $releasePython -Arguments @('-c','import paramiko; print(paramiko.__version__)')
```

Node 必须为 24.x。Python 必须能导入 paramiko；路径是本机已验证配置，不是任何电脑通用路径。换机器先验证工具，不依赖未知 PATH。不要把工作站的异常推断为项目 Bug。

## 3. 测试隧道与身份验证

在**单独终端**启动并保持它运行，不要把长驻隧道塞进顺序发布脚本：

```powershell
Set-Location E:\Shipin\ZuyuSaaS
& 'C:\Users\Zephael\.workbuddy\binaries\python\envs\default\Scripts\python.exe' scripts/db-tunnel.py
```

回到发布终端：

```powershell
Invoke-ReleaseStep -Program $releaseNode -Arguments @('--env-file=.runtime/test.env','scripts/check-test-database.mjs')
```

探针分别验证 DATABASE_URL 和 PLATFORM_DATABASE_URL：URL 必须为回环 15433 测试库，再实际执行 `SELECT current_database(), 1`。探针失败就停止，不输出连接字符串或密码。LISTENING/ESTABLISHED、node 或 ssh 进程存在均不能替代探针。paramiko 模式不一定存在 ssh.exe。

SSH 私钥：`C:\Users\Zephael\.ssh\hanjiang-deploy.pem`；主机 `root@139.196.162.194`。遇到未知/变化的主机密钥先核验指纹；不要自动接受来路不明的新密钥。

## 4. 版本、源码与凭据检查

只读检查生产 `/ready`、stable/latest.yml、rc/rc.yml，选择高于已发布版本的版本号，不能重复覆盖同版本 EXE。当前代码版本不代表线上版本，不在本手册硬编码“下一个版本”。

版本检查覆盖：根/server/client package.json；锁文件顶层 version 与 packages 中根/server/client；app.ts 的 ready 和 operations；index.ts 日志；routes/maintenance.ts；renderer utils/version.ts。contracts 是独立版本，核对其锁文件条目，不随产品版本强制升级。

```powershell
Invoke-ReleaseStep -Program $releasePython -Arguments @('scripts/check-release-secrets.py')
```

该工具只输出文件名、规则名和来源，不输出匹配的凭据。检查 Git 暂存区实际内容及未跟踪文本，命中则停止审查；提交前暂存已审查改动后再跑一次。它是启发式检查，不证明没有任何凭据，不扫描被忽略的私有目录，也不代替二进制文件审查。不要使用把命中秘密打印出来的 `git diff | grep`。

## 5. 本地受控构建（无生产操作）

```powershell
Invoke-ReleaseStep -Program $releasePython -Arguments @('scripts/release_build.py')
Invoke-ReleaseStep -Program $releasePython -Arguments @('scripts/release_build.py','--verify')
```

构建脚本依次 typecheck → build → **build:web** → package → verify-client-artifact。每步非零立即停止；启动时作废旧构建记录。不会通过跳过 Web 构建、放宽删除守卫或伪造校验结果来完成。

在构建前后核对源码、配置、清单、硬件及构建脚本的 SHA-256 清单；成功后记录服务端、contracts、Web、Electron、win-unpacked、安装包、blockmap 与清单的哈希至 `.runtime/release-build.json`。stage、activate、publish 再次验证对应输入和产物，修改后必须重新构建。

这些记录用于防止误用陈旧产物，不是防恶意本机管理员篡改的可信签名证明。依赖应先按锁文件安装；受控构建仍依赖可信工具链。不能只看 mtime 或某句 UI 文案。生成的 process-guard.generated.nsh 不算源码输入，其源 PS1 纳入输入。

## 6. 暂存（需另有发布授权）

```powershell
Invoke-ReleaseStep -Program $releasePython -Arguments @('scripts/stage-release.py')
```

脚本作废旧 staged 记录，验证构建指纹和测试库，执行核心/网关回归、迁移清单生成、上传及服务端依赖安装。**只有全部成功后才写 status=ready 的 staged-release.json**，并绑定构建指纹及版本。失败或中断后不得自行补写 ready。

新记录与服务器 release 目录应留档。stage 不激活服务，不自动迁移。持续输出写入日志时用单独终端读取日志尾部；不要把 `tail` 的延迟当成程序死锁。

## 7. 备份、迁移、激活

在已核验 SSH 连接的服务器终端执行：

```bash
set -euo pipefail
python3 /opt/za-spa-saas/operator/backup.py exercise --database za_spa_saas
readlink -f /opt/za-spa-saas/current
```

必须记录 backup.created 和 backup.restore_verified，同份备份 snapshot_compared=true；表数随版本变化，不硬编码。失败停止。保存旧 release 目录。

若有新 SQL：核对 schema_migrations，使用迁移锁、事务、失败退出，只执行缺失迁移并在同一事务登记。不能只补版本记录。评估旧客户端与数据库兼容性。迁移脚本临时保存在忽略目录，完成后只清理确认属于本次的临时执行文件，保留脱敏验收结果。不得清理生产备份。

回到发布终端：

```powershell
Invoke-ReleaseStep -Program $releasePython -Arguments @('scripts/activate-release.py')
```

激活必须使用 status=ready 且与当前构建一致的记录；检查迁移后切换 current 并重启。自动回滚是尽力恢复，不是保证成功；失败需核对真实 current、服务和数据库兼容性。仅需更新恢复 worker/迁移副本时，按对应版本方案运行 install-recovery-service.py，先处理在途恢复任务。

## 8. 发布 Windows 更新

先通过专用电脑的实际旧版→新版安装验收，确认云端健康兼容，再执行：

```powershell
Invoke-ReleaseStep -Program $releasePython -Arguments @('scripts/publish-update.py')
```

默认要求有效 Authenticode 签名。UnknownError、HashMismatch、NotTrusted 均拒绝；--allow-unsigned 也不能放过这些状态。只允许真正 NotSigned 的已批准例外。

**未签名例外不放入默认可复制流程。** 如用户明确同意，操作员需只为本次进程设置 ZA_ALLOW_UNSIGNED=1，并设置 ZA_UNSIGNED_APPROVAL_REASON（至少十字符，写明授权依据，不含密码）。脚本会把版本、安装包哈希、原因和时间记入 `.runtime/unsigned-release-exceptions.jsonl`。操作后清除两个环境变量。环境变量本身不是用户授权证明，代理必须先获得明确同意。

推荐长期配置可信证书、客户端 publisherName 和 forceCodeSigning；签名变更后重新打包及生成清单。不得伪造签名。

脚本同时发布 stable 与 rc，不提供灰度，也不是跨渠道原子操作。先验证 EXE/blockmap，再替换各自清单，最后更新固定下载别名。中断必须逐渠道核对，不能盲目重试。

## 9. 公网与实机验收

```powershell
Invoke-ReleaseStep -Program $releaseNode -Arguments @('scripts/verify-release-public.mjs')
```

该持久化脚本核对 ready、Web JS 哈希、两个更新清单和完整下载 EXE 哈希及下载别名。不再依赖临时 `.runtime/verify-gate.mjs` 或 `.runtime/verify-release-public.mjs` 作为必要工具。

生产 UI 脚本另行审查后执行：verify-production-web.mjs、verify-production-management-fixes.mjs 需要 Playwright 及私有平台测试凭据；它们会真实登录，不是匿名检查。不得打印账号文件或将正式业务作为虚构资金测试对象。

实机流程：旧版运行 → 检查更新 → 下载 → 退出 → 安装 → 重启，验证版本、登录信息与业务数据。成功启动新版不等于升级全链通过。网页可见时约每分钟提示更新；客户端启动约15秒后、其后每15分钟检测，下载/安装需用户确认。

## 10. 回滚与留档

云端只回到与数据库、权限及客户端兼容的旧 release；涉及恢复功能先停 timer 并等待任务完成。严禁直接整库还原覆盖新营业数据。旧清单不能让已升级客户端自动降级，通常发布更高修复版本。

留档：版本与代码快照、构建指纹、测试结果、备份/恢复校验、迁移、新旧 release、EXE 哈希/签名状态、渠道状态、实机结果及未验证项。不要因为临时脚本清理而删除这些必要记录。

生产坐标：139.196.162.194；部署 /opt/za-spa-saas；API 127.0.0.1:8791；PostgreSQL 127.0.0.1:5433；生产库 za_spa_saas；网页 https://saas.zephael.cn/；后台 /platform；Windows 固定下载 /updates/windows/stable/ZA-Thera-Setup.exe。
