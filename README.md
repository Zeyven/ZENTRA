# ZA Thera｜澜序

**洗浴娱乐行业智慧运营系统 · 让门店，自成秩序。**

面向洗浴、足浴等门店的多商家、多门店 SaaS。一个 npm workspaces 仓库管理 API、商家 Web、平台后台、Windows 客户端、共享业务契约与门店硬件联调网关。

- 当前源码版本：**1.0.22**；本分支：**ZAThera**。
- 商家 Web：[saas.zephael.cn](https://saas.zephael.cn/)
- 平台后台：[saas.zephael.cn/platform](https://saas.zephael.cn/platform)
- Windows：[稳定版下载入口](https://saas.zephael.cn/updates/windows/stable/ZA-Thera-Setup.exe)
- Windows 应用标识：`cn.zephael.zaspa.saas`；独立用户数据目录：`ZA-SPA SaaS`。

> 源码可用不代表所有外设已对接。点钟王、技师房播报器、专用刷牌器以及支付/团购网关的支持边界见下文。正式环境不内置示例商家、业务数据或默认管理员密码。

## 目录

1. [功能与适用边界](#功能与适用边界)
2. [架构与源码导航](#架构与源码导航)
3. [开发环境](#开发环境)
4. [数据库与环境配置](#数据库与环境配置)
5. [本地启动](#本地启动)
6. [测试与构建](#测试与构建)
7. [发布与自动更新](#发布与自动更新)
8. [硬件接入](#硬件接入)
9. [安全与运维](#安全与运维)
10. [文档与常见问题](#文档与常见问题)

## 功能与适用边界

| 模块 | 源码覆盖范围 |
| --- | --- |
| 房态与收银 | 房间状态、开房、挂单、项目商品、加钟、订单、结账与撤销相关业务 |
| 会员资产 | 单店或商家通用会员、本金、赠送余额、次数、积分、充值退款及分配记录 |
| 技师与钟房 | 排钟、服务状态、上下钟、加钟审批、钟务、提成及结算规则 |
| 库存与采购 | 商品库存、采购收货、退货、盘点、同商家跨店调拨 |
| 经营管理 | 预约、排队、交接班、审批、报表、价格规则、连锁模板 |
| 营销 | 优惠券、会员等级、充值方案、营销配置及公开顾客入口 |
| 平台管理 | 商家开通/停用、门店维护、权限、审计、运行状态、备份恢复及平台维护入口 |
| 桌面端 | Windows 安装器、应用内更新、设备检测及本机只读网关 |

业务层级为 **平台 → 商家 → 门店 → 员工**。商家账号按商家独立命名，员工按店授权；数据库通过商家标识、对象归属校验及 RLS 隔离。共享会员模式下，资金分配记录充值来源店和消费店，退款/反结账按原记录处理。

当前平台代码包含平台超级维护入口，不应将早期设计文档中的“平台只能经商家授权访问”当作当前实现。平台维护仍有身份认证、目标商家范围、操作校验和审计；部署前应按实际运营要求审查并管理此权限。

不包含在线 SaaS 订阅计费、自动分账、跨商家共享会员、离线收银同步和旧版业务数据迁移。外部支付/团购及部分设备为接口预留或联调阶段，不能以配置保存成功视为接入完成。

## 架构与源码导航

| 层 | 技术 |
| --- | --- |
| 服务端 | Node.js 24、TypeScript、Express 5、PostgreSQL、Socket.IO |
| 商家与平台 UI | React 18、Vite、TypeScript、Tailwind CSS、Zustand |
| Windows | Electron、electron-vite、electron-builder / NSIS、electron-updater |
| 共享契约 | Zod 运行时校验、共享类型、权限和金额相关定义 |
| 验证 | Node Test Runner、Playwright、Python 发布流程测试 |

依赖以 `package-lock.json` 为准。根、server、client 当前版本是 `1.0.22`；`packages/contracts` 独立版本为 `1.0.11`，不要全仓替换版本号。

```text
apps/
  server/src/
    app.ts                  API 应用与公共中间件
    index.ts                监听、任务与退出生命周期
    db/                     001–041 SQL 迁移、连接池与商家上下文
    routes/                 平台、商家与顾客业务接口
    services/               业务服务与维护逻辑
  client/
    src/main/               Electron 主进程、更新、设备检测
    src/preload/            受控 IPC 桥
    src/renderer/src/       Web 与桌面共用 React 界面
    build/                  品牌资源、NSIS 进程保护
packages/contracts/         共享契约
scripts/                    开发、迁移、验收、备份和发布工具
tests/                      API、业务、桌面与浏览器测试
tools/hardware-gateway/     点钟王只读网关及本机模拟器
docs/                       操作手册、设计、发布及验收记录
```

API 按 `/api/platform/v1/*`、`/api/merchant/v1/*`、`/api/public/v1/*` 划分。门店选择不能改变已认证商家身份。金额接口以元表示，服务端负责验证、精确运算和事务更新；实时订阅也执行身份与门店范围检查。

## 开发环境

- Node.js **24.x**（项目 engines 为 `>=24 <25`）和 npm。
- PostgreSQL **16**；使用独立开发/测试数据库，不连接生产库跑测试。
- Windows 客户端打包/安装验收需要 Windows。
- 部署脚本使用 Python 3 和 `paramiko`；普通 Web 开发不需要生产 SSH 权限。
- Playwright 浏览器测试需要 Chromium。

```powershell
git clone --branch ZAThera --single-branch https://github.com/Zeyven/ZENTRA.git
cd ZENTRA
node --version
npm ci
```

`npm ci` 会通过根 `prepare` 构建共享契约。若电脑存在多套 Node，请确认终端、构建工具与发布脚本使用同一套 Node 24。

## 数据库与环境配置

### 1. 创建隔离数据库和角色

迁移要求下列角色体系，不能简单把所有连接都指向 postgres 超级用户：

| 角色 | 用途 |
| --- | --- |
| `saas_runtime` | 商家运行权限组，NOLOGIN / NOSUPERUSER / NOBYPASSRLS |
| `saas_platform` | 平台运行权限组，NOLOGIN / NOSUPERUSER / NOBYPASSRLS |
| `saas_migrator` | 数据库所有者及迁移账号，与运行账号分离 |
| `saas_test_app` | 开发测试连接账号，加入 saas_runtime |
| `saas_test_control` | 开发测试平台连接账号，加入 saas_platform |

由本地数据库管理员创建 `za_spa_saas_test`，所有者为 `saas_migrator`，授予两个测试账号 CONNECT；使用独立随机口令。迁移脚本需要这些角色存在，并会设置表级权限与 RLS。正式库名称为 `za_spa_saas`，使用独立的 `saas_app` / `saas_control` 登录账号。

`scripts/bootstrap-databases.py` 是针对现有远程部署的运维工具，会连接 SSH 并创建数据库/环境文件；**不是通用的本地一键初始化命令**。新开发机应先让管理员完成本地实例、角色及数据库配置。

### 2. 配置私有环境文件

```powershell
New-Item -ItemType Directory -Force .runtime | Out-Null
Copy-Item .env.example .runtime/test.env
```

编辑 `.runtime/test.env`，替换全部占位值。服务端不会自动读取普通 `.env`，下文通过 Node 的 `--env-file` 显式载入。

| 变量 | 含义 |
| --- | --- |
| `DATABASE_URL` | 商家运行连接，开发指向 za_spa_saas_test |
| `PLATFORM_DATABASE_URL` | 平台运行连接，使用不同账号 |
| `MIGRATION_DATABASE_URL` | 仅迁移/初始化使用，不能放进客户端 |
| `MERCHANT_JWT_SECRET` | 商家 JWT 密钥，至少 64 字符 |
| `PLATFORM_JWT_SECRET` | 平台 JWT 密钥，至少 64 字符，且与商家密钥不同 |
| `AUTH_ENCRYPTION_KEY` | 32 字节密钥的 64 位十六进制表示 |
| `NODE_ENV` | 本地测试用 test；生产用 production |
| `PORT` | 本地 API 示例 8791，浏览器测试服务器使用 8792 |
| `PUBLIC_ORIGIN` | 生成顾客入口/激活链接使用的地址 |

生成独立密钥可使用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`，每个密钥分别生成，存入私有环境文件，不提交输出。

### 3. 迁移及首次管理员

```powershell
node --env-file=.runtime/test.env --import tsx scripts/migrate.ts
```

迁移脚本使用迁移锁和逐文件事务，只执行尚未登记的 SQL。首次初始化平台前，在私有环境文件临时配置 `INIT_ADMIN_USERNAME`、`INIT_ADMIN_PASSWORD`、`INIT_ADMIN_NAME`：

```powershell
node --env-file=.runtime/test.env --import tsx scripts/init-platform.ts
```

只在平台账号表为空时初始化，不覆盖现有账号，也不创建商家或业务记录。初始化成功后移除 INIT_ADMIN_PASSWORD 等一次性配置。平台密码当前要求 8–20 字符，无仓库默认密码。

## 本地启动

终端 A：

```powershell
node --env-file=.runtime/test.env --import tsx apps/server/src/index.ts
```

终端 B：

```powershell
npm run dev:web
```

- Web：`http://127.0.0.1:5175/`
- 平台：`http://127.0.0.1:5175/platform`
- API 健康：`http://127.0.0.1:8791/ready`

Vite 默认代理 API 与 Socket.IO 到 8791；需要更换目标时设置 `VITE_DEV_API_TARGET`。测试模式下定时任务默认不启动，需明确设置 `SAAS_TEST_JOBS=1` 才执行。

桌面开发：`npm run dev -w @za-spa/client`，开发渲染器端口 5176，API 仍需单独启动。正式桌面端的服务地址由 `apps/client/src/main/security.ts` 固定，开发环境代理与正式地址不要混用。

首次经营流程：平台创建商家及老板邀请 → 老板激活 → 创建门店 → 配置房间、员工、项目和权限 → 使用商家工作空间。不要在生产创建虚构资金记录来做演示。

## 测试与构建

```powershell
npm run typecheck
node --import tsx --test tests/automatic-updates.test.ts tests/update-location.test.ts
node --test tests/release-safety.test.mjs
node --test tools/hardware-gateway/*.test.mjs
npm run test:core
```

`test:core` 读取 `.runtime/test.env`。全量 TypeScript 业务测试可运行：

```powershell
npm run build -w @za-spa/contracts
node --env-file=.runtime/test.env --import tsx --test --test-concurrency=1 tests/*.test.ts
```

浏览器测试：

```powershell
npx playwright install chromium
npm run build
npx playwright test
```

Playwright 配置会启动独立测试 API 8792、Web 5175 和渲染器预览 5177，运行前这些端口应空闲，且测试库须完成迁移。部分桌面/硬件用例有额外平台条件，参见具体测试文件。发布专用 `check-test-database.mjs` 限定本地 15433 隧道；普通本地测试不必复用生产隧道。

构建顺序：

```powershell
npm run build
npm run build:web -w @za-spa/client
npm run package -w @za-spa/client
node scripts/verify-client-artifact.mjs
```

| 命令/目录 | 产物 |
| --- | --- |
| npm run build | contracts/dist、server/dist、Electron main/preload/renderer |
| build:web | apps/client/out/web，必须单独构建 |
| package | apps/client/release 下 EXE、blockmap、latest.yml 与 win-unpacked |

只执行 `npm run build` **不会重建网页版**。不要上传陈旧 out/web，也不要把安装包、依赖、私有环境文件提交到 Git。

## 发布与自动更新

完整操作步骤以 [发布手册](docs/RELEASE-PUSH-GUIDE.md) 为准。现有部署脚本带有本机/服务器路径假设，新的维护者须先检查并适配；不得拿克隆仓库直接执行生产初始化脚本。

顺序为：版本确认 → 构建与来源指纹 → 测试 → stage → 生产备份及临时恢复比对 → schema 检查 → activate → 更新渠道推送 → 公网哈希验证 → 实机升级验收。

- 新版本必须递增，不覆盖已发布的同版本 EXE。
- Windows 更新使用 stable / rc 独立清单，文件上传并校验后再替换清单。
- 客户端启动后和每 15 分钟检查更新，下载与安装由用户确认，不启用降级。
- V1.0.22 固定使用当前运行的安装目录，避免注册表陈旧导致安装到另一磁盘。
- 网页和平台后台发布后提示刷新；刷新前先完成当前操作。
- 当前 V1.0.22 为未签名安装包，已按本次明确授权例外发布；并非长期关闭签名门禁。长期应配置可信代码签名。
- 回滚云端代码必须考虑当前数据库结构及客户端兼容性；不能整库还原覆盖发布后的营业数据。

[1.0.22 发布及升级验收记录](docs/RELEASE-1.0.22.md) 包含测试、哈希、备份和本机结果。它说明本次验证范围，不保证所有门店已升级。

## 硬件接入

详见 [硬件网关说明](tools/hardware-gateway/README.md) 和 [硬件验收边界](docs/HARDWARE-ACCEPTANCE-FROZEN.md)。

- **点钟王**：已有设备检测、房间绑定、授权及受限只读联调。完整设备登录、菜单、业务写入及真实固件兼容尚未完成门店验收。
- **刷牌器**：通用键盘输入型可在检测框读卡；USB 接口不等于通用键盘模式，专用驱动/串口型号需适配。
- **技师房播报器**：配置及诊断接口预留，不能把本机语音等同于外部设备播报送达。
- **支付、团购等渠道**：必须获得独立授权及接口协议并完成验签联调，配置页面存在不等于官方网关接通。

本机模拟器：

```powershell
node tools/hardware-gateway/simulator.mjs
```

打开 `http://127.0.0.1:18033/`。模拟器使用合成房间和本机协议通信，不接触生产订单，也不是厂商固件模拟器。不能以模拟器通过替代门店实机验收。

## 安全与运维

- 平台与商家认证分域；商家命名空间、门店授权、对象归属和实时订阅分别校验。
- 商家运行数据库账号不应具有超级用户、BYPASSRLS、DDL 或全表清空权限。
- 不上传 `.runtime`、环境文件、真实口令、证书私钥、恢复密钥、厂商 Session、数据库备份和日志。
- `.gitignore` 是首层过滤，不代替提交前凭据审查；`check-release-secrets.py` 仅做启发式检查，不能保证发现所有秘密。
- 备份应定期实际恢复到隔离库校验；单商家恢复需要核对目标、状态、关联数据和审计。
- 多商家 SaaS 的权限、资金及恢复操作应优先在隔离环境回归，不能直接在生产做破坏性测试。

本分支是经过过滤的当前源码快照，没有导入开发机的旧 Git 历史、私有数据、第三方硬件程序或构建输出。

## 文档与常见问题

| 问题 | 处理 |
| --- | --- |
| Missing DATABASE_URL | 确认通过 --env-file 加载配置；npm dev 不自动载入私有文件 |
| JWT secret 报错 | 两个 JWT 密钥至少 64 字符且互不相同 |
| 数据库权限/RLS 报错 | 检查角色组、迁移及运行账号，不能改用超级用户掩盖问题 |
| 网页与安装包内容不同 | 补跑 build:web 并校验各自产物来源 |
| 发布后没有更新提醒 | 确认新版本高于已装版本，检查渠道清单及哈希 |
| 重启后需要登录 | 当前认证使用 sessionStorage；记住账号不等于保存密码或永久登录 |
| 设备显示未接入 | 查明协议、授权与实机条件，不应强制显示成功 |

更多资料：[运维手册](docs/OPERATING-RUNBOOK.md)、[自动更新](docs/AUTOMATIC-UPDATES.md)、[品牌规范](docs/BRANDING.md)、[实现设计](docs/IMPLEMENTATION.md)、[维护恢复](docs/maintenance-recovery.md)。历史文档包含当时的状态和约束，遇到差异以当前代码和最新验收记录核实。

## 许可证

沿用目标仓库已有 [MIT License](LICENSE)。依赖及第三方资源仍遵循各自许可证；品牌标识和商标使用不因源码许可证自动获得授权。
