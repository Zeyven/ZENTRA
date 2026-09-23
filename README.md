# AYRA

按照 **AYRA BASELINE v1.0 — FROZEN** 实施的通用智能体工作空间。当前为 **M0 工程基础**；业务能力、实施安全和生产就绪状态尚未验证。

原始白皮书未修改。完整白皮书及其文本提取作为本地实施输入，不随公开源码发布；原文件 SHA-256 位于 `docs/baseline/`。实施记录见 `docs/adr/0001-m0-baseline.md`，验收结果见 `docs/implementation/M0.md`。按白皮书逐阶段推进，M0 的 DoD 未全部通过时不进入 M1。

## 开发环境

需要 Node.js 24、pnpm 11.25.0、运行中的 Docker Engine + Compose v2。桌面原生编译额外需要 Rust 及平台工具链；macOS 使用 Xcode Command Line Tools，Windows 使用 C++ Build Tools 和 WebView2。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 是本地启动入口：保留已有 `.env.local` 或生成随机本地凭据，启动 PostgreSQL 18 / Redis / Temporal dev / S3-compatible MinIO，验证基础设施，然后启动 API、Worker 和 Web。任何步骤失败都会停止，不会回退到内存数据库或模拟基础设施。API 和 Worker 由启动器加载本地环境。独立启动服务前需在进程中提供相同环境变量。

| 入口                 | 本地地址 / 行为                            |
| -------------------- | ------------------------------------------ |
| Web                  | http://localhost:3000                      |
| API liveness         | http://127.0.0.1:4000/health/live          |
| API readiness        | `/health/ready` 返回 503，业务服务尚未实现 |
| OpenAPI              | http://127.0.0.1:4000/openapi.json         |
| Temporal dev UI      | http://127.0.0.1:8233                      |
| Object store console | http://127.0.0.1:9001                      |
| Worker               | 仅进程骨架，不接受或执行任务               |

仅查看应用骨架可运行 `pnpm dev:web`，不代表完整本地环境验收。移动端：`pnpm --filter @ayra/mobile dev`。桌面原生：`pnpm --filter @ayra/desktop dev:native`。

## 验证

```sh
pnpm check
pnpm infra:verify
pnpm build:desktop:native
```

`pnpm check` 依次执行 lint、架构边界检查、格式检查、全部 package/app 的 typecheck、确定性测试和构建。五个 app 可分别使用 `pnpm --filter @ayra/<app> build` 构建。Desktop 的普通 build 是 WebView 前端；`build:desktop:native` 额外构建 Rust 可执行文件。Mobile build 导出 iOS、Android 与 Web JS/assets，原生 IPA/APK 编译和真机验收属于后续阶段，不等同本命令通过。

GitHub Actions 配置包括工程检查、真实 Compose 服务验证及 macOS/Windows 原生编译。配置存在不等于远端 CI 已通过。

## 工程边界

- `apps/`：web、desktop、mobile、api、worker。
- `packages/domain`：AYRA 自有类型，不依赖 Provider SDK。
- `packages/config`：服务端配置验证及显式 public allowlist。
- 其余共享包按白皮书 §3.3 保留边界，空包不代表对应能力已实现。
- 应用数据库连接固定使用 `application_role`；M1 才引入身份、租户表和 RLS 验证。
- 供应商密钥不进入客户端、源码或日志。`.env.local` 保持 git 忽略；初始化不覆盖已有凭据。
- Compose 只供本地开发、端口仅监听 loopback。生产部署、密钥管理、Updater 签名与高风险操作均未开放。

停止基础设施使用 `pnpm infra:down`，保留数据卷。M0 不自动删除用户数据、修改白皮书、确定 OPEN 商业参数或调用付费模型。
