# Page Blueprints · Proposal 0.1

## Website

### Homepage

1. Hero：左侧 AYRA / One workspace for deeper work.；副标题 A unified AI workspace for research, execution, and creation.；主要 Download for macOS，次要 Download for Windows，三级 Watch overview。右侧 MacBook mockup 内展示 AYRA Desktop。
2. What is AYRA：一句话解释桌面 AI 工作环境，配少量产品细节图，不加入 Dashboard。
3. Chat. Work. Build.：三个等权简洁卡片，文案仅 Think with AI. / Turn ideas into outcomes. / Create software with AI.
4. Why AYRA：Context Continuity / Unified Artifacts / Long-running Agents / Privacy First。使用留白与简洁行列结构。
5. AI Agent Capability：用 Goal → Progress → Result 的具体工作例子说明，避免内部 Agent、Planner、Executor 列表。
6. Privacy & Security：简短原则 + Security 页链接；未验证能力不能表述为已经实现。
7. Download CTA：突出 AYRA Desktop，按真实发布状态渲染。
8. Footer：Product、Download、Security；仅放真实存在的政策与联系方式。

### Product

用同一个目标从 Chat 思考、Work 产出到 Build 实现，呈现内容连续性。少量大幅桌面产品图搭配短文。每段回答使用者得到了什么，避免长功能表。

### Download

AYRA Desktop；macOS / Windows 选择；真实版本、系统要求、架构、安装说明、校验信息与更新说明。没有发布包时显示“尚未发布”，按钮不可伪装成功。Watch overview 只有真实视频可用时才开放。

### Security

以通俗语言解释数据边界、权限/审批、密钥保护、执行隔离、数据删除与恢复。区分“设计要求”“已实现”“已验证”，不把 Privacy First 扩张为全本地推理或零外发承诺。供应商数据传输与保留策略以实际配置为准。

## Desktop

### Home

Where：当前 Workspace。
Happening：一个 Today’s Focus，近期工作列表。
Next：Continue 或开始一个目标。Projects / Activity 为低权重支持区域。无工作时呈现简洁开始入口，不展示虚构统计。

### Chat

Where：当前 conversation 与 linked project。
Happening：对话内容及明确的生成/等待/失败状态。
Next：提问、补充上下文、打开成果。右侧 Context / Artifacts 可收起。消息输入与发送状态完整。

### Work

Where：Project → Task → Artifact。
Happening：文档或研究成果是中央视觉重点。
Next：继续编辑、查看来源、处理需要的输入或审阅成果。Resources / Insights 辅助，无营销大标题占据编辑空间。

### Build

Where：项目与 repository。
Happening：目标、当前进度、修改或 Preview；不暴露内部 agent 编排。
Next：查看修改、审批、检查测试或打开预览。Code 可切换，Tests 显示真实结果；失败保留恢复路径。

### Project Workspace

顶部项目名称与目标，主体 Recent work / Tasks / Artifacts，Resources 按需进入。所有工作有项目归属，成果关联任务，Task 与 Run 在内部模型中保持区别，不将全部系统结构暴露给用户。

### Activity / Settings

Activity：可读时间线与需要关注的事件；不是日志控制台。
Settings：账户、工作区与用户偏好。Models/MCP 等系统配置仅在合适权限和上下文中开放，不进入一级任务导航。

## Review order

1. Foundations 与组件职责。
2. Website Home + Desktop Home 的关键视觉稿，确认同一品牌、不同任务。
3. 其余官网和桌面页面稿。
4. 交互状态与响应式稿。
5. 选定稿后映射到 React/Tauri；此阶段之前不继续页面实现。
