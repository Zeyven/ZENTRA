# AYRA Design System · Implementation 0.1

状态：首轮 React/Tauri UI 实现。用户要求开始开发后，采用第三版 Calm Narrative 的官网结构；不是 Figma 源文件，业务能力尚未交付。
日期：2026-09-23。

## Authority and scope

本规范记录用户在白皮书之后提供的 Website + Desktop UI 要求。白皮书原文件保持不变。当前任务的 UI 边界以用户这份补充要求为准。已有 Web 工作空间是早期草稿，不作为最终官网。

Website = Marketing Website + Brand Experience + Download Portal。
Desktop = 核心工作空间。Mobile = 未来 Companion，不缩小桌面 UI 充当移动产品。

官网路径仅规划 `/`、`/product`、`/download`、`/security`。官网没有登录后工作空间、在线 Chat/Build/Projects、Dashboard。桌面内部保留 Home、Chat、Work、Build、Projects、Activity、Settings。

## Design intent

Calm / Focused / Professional / Powerful / Invisible Complexity。

品牌主张：One workspace for deeper work.
副标题：A unified AI workspace for research, execution, and creation.

每个画面只设一个主要视觉中心和一个主要动作。内部复杂度通过目标、可理解的进度、成果表达；不将 Models、MCP、Skills、Memory 或内部 agent topology 放入一级导航。

## Figma-like file structure

1. `00 · Foundations`：品牌、语义颜色、字号、间距、圆角、阴影、动效与无障碍规则。
2. `01 · Components`：Auto Layout 组件及 variants、states、slots。
3. `02 · Website`：四页桌面画板与 tablet/mobile 变体。
4. `03 · Desktop`：Home、Chat、Work、Build、Project Workspace；Activity/Settings 共用壳。
5. `04 · Flows`：官网了解→信任→下载；桌面目标→进度→成果。
6. `05 · Review`：Clarity、Deference、Depth、Consistency 检查与可用性证据。

Foundations、Components 和三版页面方向已先行记录。随后按用户继续开发的指令进入 React/Tauri 实现。

## Brand assets

- 浅色导航：用户 ZIP 中 `zentra-nav-charcoal.svg`，不重绘、不改变图形。
- 应用图标：同包 Porcelain 版，保持原始比例与安全区。
- 产品名称：AYRA，文字与图形分离布局；不把 ZENTRA 文件名作为产品名称。
- 景观照片：只在官网产品叙事或桌面少量环境区域使用。不得影响正文对比度或挤占内容。
- 官网 Hero 的右侧必须是 MacBook 产品图，屏幕内为 AYRA Desktop；不能用 Web Dashboard 替代，也不在网页本体绘制 macOS 红黄绿窗口控件。

## Density and hierarchy

| Surface           | Primary focus                   | Supporting content                   | Density                     |
| ----------------- | ------------------------------- | ------------------------------------ | --------------------------- |
| Website Home      | 品牌主张 + MacBook 中的桌面产品 | 下载与概览                           | 宽松、叙事式                |
| Desktop Home      | Today’s Focus / 下一步          | Continue Working、Projects、Activity | 轻量工作起点                |
| Desktop Chat      | Conversation                    | Context、Artifacts                   | 对话优先，右侧可收起        |
| Desktop Work      | Document / Research             | Resources、Insights                  | 文档最大，辅助信息从属      |
| Desktop Build     | 当前修改或 Preview              | Repository、进度、Tests              | 结果优先，Code 为可切换细节 |
| Project Workspace | 项目目标与最近工作              | 任务、资源、成果                     | 项目上下文，不复制全局首页  |

## Shared implementation map

白皮书 pnpm monorepo 保留：`apps/web` 承载官网，`apps/desktop` 承载 Tauri 工作空间。`packages/design-tokens` 负责 token 实现，`packages/ui` 提供共享基础组件与不同 surface 的组合。根目录 `design-system/` 是设计规范源，避免建立第二套冲突的运行时代码。

组件目录规范见 `components/README.md`；token 规范见 `tokens/README.md`；页面规范见 `pages/README.md`。

## State truth

Design sample 与真实产品状态明确分开。页面稿可用标注清楚的样例内容说明布局；运行中的产品只能显示真实账户、任务、授权与执行结果。未发布安装包不提供假下载。未录制概览不弹出伪视频。未通过的安全能力不作已经具备的宣传承诺。

## Acceptance checklist

- Clarity：首屏能理解 AYRA 是桌面 AI 工作环境；每个页面有位置、状态、下一步。
- Deference：装饰不能比内容更醒目；不为填满页面增加统计卡。
- Depth：导航、主要内容、上下文三层清楚；只在浮层使用明显阴影。
- Consistency：全部组件引用共同语义 token，图标统一，状态名称一致。
- Desktop：macOS/Windows 各自检查，不能以浏览器预览替代原生验收。
- Website：1440 / 834 / 390 三类宽度检查；键盘操作、焦点、对比度、reduced motion。
- Boundary：官网不出现工作空间操作；Desktop 才承载 Chat/Work/Build。

## Existing work disposition

M0 提交 `923601b` 的 GitHub Actions 全部通过：https://github.com/Zeyven/ZENTRA/actions/runs/35835394726 。本机基础设施按用户选择仍未验证。

本次补充要求前的 UI 草稿留在本地，尚未提交到远程。它的构建检查通过，但应按新产品边界拆分；旧视觉检查的窄屏缺口记在根目录 `design-qa.md`。不继续润色错误边界的 Web 工作空间。
