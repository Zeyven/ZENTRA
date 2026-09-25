# AYRA

按照 **AYRA BASELINE v1.0 — FROZEN** 实施的通用智能体工作空间。M0 工程基础、M1 身份/Workspace/Policy 与 M2 Core Domain 的工程 DoD 已通过；M3 Durable Task、M4 Agent Runtime/Model Gateway 与 M5 Approval 正在实施。完整业务能力和生产就绪状态尚未验证。

原始白皮书未修改。完整白皮书及其文本提取作为本地实施输入，不随公开源码发布；原文件 SHA-256 位于 `docs/baseline/`。实施记录见 `docs/adr/0001-m0-baseline.md` 和 `docs/implementation/`。按白皮书逐阶段推进。

## 开发环境

需要 Node.js 24、pnpm 11.25.0、运行中的 Docker Engine + Compose v2。桌面原生编译额外需要 Rust 及平台工具链；macOS 使用 Xcode Command Line Tools，Windows 使用 C++ Build Tools 和 WebView2。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 是本地启动入口：保留已有 `.env.local` 或生成随机本地凭据，启动 PostgreSQL 18 / Redis / Temporal dev / S3-compatible MinIO，验证基础设施，运行带校验和的数据库迁移，然后启动 API、Worker 和 Web。任何步骤失败都会停止，不会回退到内存数据库或模拟基础设施。API 和 Worker 由启动器加载本地环境。独立启动服务前需在进程中提供相同环境变量。

| 入口                 | 本地地址 / 行为                          |
| -------------------- | ---------------------------------------- |
| Web                  | http://localhost:3000                    |
| API liveness         | http://127.0.0.1:4000/health/live        |
| API readiness        | `/health/ready` 返回 503，产品未发布就绪 |
| OpenAPI              | http://127.0.0.1:4000/openapi.json       |
| Temporal dev UI      | http://127.0.0.1:8233                    |
| Object store console | http://127.0.0.1:9001                    |
| Worker               | 正式入口仍是进程骨架，不接受或执行任务   |

仅查看官网可运行 `pnpm dev:web`；桌面 UI 独立预览使用 `pnpm --filter @ayra/desktop dev`（http://127.0.0.1:1420），不代表完整本地环境验收。移动端：`pnpm --filter @ayra/mobile dev`。桌面原生：`pnpm --filter @ayra/desktop dev:native`。

## 验证

```sh
pnpm check
pnpm infra:verify
pnpm migrate
pnpm test:integration
pnpm test:api
pnpm test:core
pnpm build:desktop:native
```

`pnpm check` 依次执行 lint、架构边界检查、格式检查、全部 package/app 的 typecheck、确定性测试和构建。五个 app 可分别使用 `pnpm --filter @ayra/<app> build` 构建。Desktop 的普通 build 是 WebView 前端；`build:desktop:native` 额外构建 Rust 可执行文件。Mobile build 导出 iOS、Android 与 Web JS/assets，原生 IPA/APK 编译和真机验收属于后续阶段，不等同本命令通过。

macOS 开发预览可运行 `rustup target add x86_64-apple-darwin aarch64-apple-darwin` 后执行 `pnpm build:desktop:preview:macos`。该命令生成 Intel + Apple Silicon 通用 DMG；CI 校验磁盘映像并保留 7 天的构建产物。它是未签名的 `0.0.0` 原型，尚未经过 Developer ID 签名、公证或发布验收，不应作为官网正式下载提供。

Windows 开发预览可在 Windows 上运行 `pnpm build:desktop:preview:windows` 生成 NSIS 安装程序；CI 计算 SHA-256 并保留 7 天的构建产物。Windows 预览同样未签名，也尚未完成安装后的真实功能与安全验收。

GitHub Actions 配置包括工程检查、真实 Compose 服务验证及 macOS/Windows 原生编译。配置存在不等于远端 CI 已通过。

## 工程边界

- `apps/`：web、desktop、mobile、api、worker。
- `packages/domain`：AYRA 自有类型，不依赖 Provider SDK。
- `packages/config`：服务端配置验证及显式 public allowlist。
- AgentRuntime/ModelProvider 自有接口和模型策略骨架已落地；真实模型适配器、Tool Gateway 与 Vault 尚未接入。其余共享包按白皮书 §3.3 保留边界，空包不代表对应能力已实现。
- 应用数据库连接固定使用 `application_role`；M1 已加入身份映射、租户表、Policy 与 RLS，仍未完成供应商和客户端集成。
- 供应商密钥不进入客户端、源码或日志。`.env.local` 保持 git 忽略；初始化不覆盖已有凭据。
- Compose 只供本地开发、端口仅监听 loopback。生产部署、密钥管理、Updater 签名与高风险操作均未开放。

停止基础设施使用 `pnpm infra:down`，保留数据卷。M0 不自动删除用户数据、修改白皮书、确定 OPEN 商业参数或调用付费模型。

## Website 与 Desktop UI

官网仅提供 `/`、`/product`、`/download`、`/security`，承担产品介绍与下载入口。原 Web Chat/Work/Build/Projects/Settings 路由已移除；实际工作空间属于桌面应用。安装包尚未发布，下载页明确显示不可用。

桌面有 Home、Chat、Work、Build、Projects、Activity、Settings，支持页面搜索、上下文收起、分类切换，以及 Chat/Work 草稿在此设备自动保存、从首页继续和复制/导出。Chat 预览可把想法保存为本机笔记，并提供导出与删除；它们尚未同步到账号，也不会发送给 AI。服务端 Conversation 消息存储已实现，但 Desktop 尚未接入身份服务或该 API。项目、账户、模型和任务服务未连接，不伪造执行结果。设计与验收记录见 `design-system/`、`design-qa.md` 和 `docs/implementation/UI.md`。
