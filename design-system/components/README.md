# Component Library · Proposal 0.1

每个组件在设计文件中使用 Auto Layout；公开 size / variant / state / leading icon / trailing icon / content slots，业务状态不写死在基础组件中。

| Component         | Variants and states                                                                 | Rules                                                       |
| ----------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Button            | primary / secondary / quiet；default / hover / pressed / focus / loading / disabled | 同一区域只有一个 primary；loading 保留宽度并说明动作        |
| Card              | content / interactive / featured                                                    | 默认用留白分组，只有独立对象使用卡片，不嵌套卡片墙          |
| Navigation        | website / desktop                                                                   | 官网 Product、Security、Download；桌面任务入口独立配置      |
| Sidebar           | expanded / compact                                                                  | AYRA、Home、Chat、Work、Build、Projects、Activity、Settings |
| CommandBar        | idle / query / results / empty / error                                              | 仅 Desktop；按项目、任务、成果分组，键盘上下选择            |
| ArtifactCard      | document / report / code / file；draft / ready / failed                             | 成果标题、类型、来源任务、更新时间与明确打开动作            |
| TaskCard          | queued / working / waiting / completed / failed / canceled                          | 展示 Goal、Progress、Result，不展示内部 agent topology      |
| ProjectCard       | active / archived；empty / populated                                                | 项目目标与最近活动优先，不堆叠多个指标                      |
| WorkspaceSwitcher | closed / open / loading / empty / error                                             | 当前 workspace 明确；切换后所有上下文同步                   |
| ContextPanel      | open / collapsed / empty                                                            | 可收起；不挤压主要内容；链接项目、资源、成果                |
| ProgressSummary   | working / needs-input / complete / failed                                           | AYRA is working…；解释当前动作、等待原因、下一步            |
| DownloadOption    | available / unsupported / unreleased                                                | 真实平台、架构、版本、系统要求；未发布时禁止假成功          |
| EmptyState        | first-use / no-results / disconnected / permission-denied                           | 位置、原因、下一步；不能将所有状态写成“暂无数据”            |
| Notice            | info / warning / error / success                                                    | 就近说明；操作失败保留输入；可关闭但关键信息不只用 toast    |

## Structural recipes

Website Header = Brand + Navigation + Download CTA。Website Footer = Product + Download + Security + 真实可用的政策链接。
Desktop Shell = Sidebar + Workspace Topbar + Main Surface + Optional Context Panel。
Topbar = Workspace 左、Global Search 中、Notification/Profile 右。

Home 不以 KPI 卡片为中心。优先 Today’s Focus 单个主要任务，其次 Continue Working 小型列表、Projects、Activity。
Chat 以对话为中心，Context 与 Artifacts 从属；不借空状态宣传内部系统能力。
Work 以文档或研究成果为中心；Resources 与 Insights 为可收起上下文。
Build 默认强调目标、当前修改与预览；Repository/Code/Tests 是按需打开的工具，不把整个应用设计成 IDE。

## Responsive behavior

官网组件支持桌面、平板、移动重新排布；MacBook 产品图按比例缩放。
Desktop 主要验证 macOS/Windows 的桌面窗口；窄窗口折叠辅助面板并切换页签，不将桌面三栏强行等比压缩。Mobile Companion 另立流程，不沿用 Sidebar 缩小版。

## Implementation decision

沿用 React/Tauri 和白皮书包边界，不引入第二套设计语言。现有 Phosphor 图标可继续作为统一 outline 图标候选；在页面稿评审中复核 stroke/size。基础组件通过语义 token 定制，业务组合与基础组件分离。

首轮实现位于 packages/ui/src/components：Button、Card、Navigation、Sidebar、ArtifactCard、TaskCard、ProjectCard、CommandBar。本文列出的完整业务状态仍属于后续目标，当前仅实现与开发预览相符的状态。
