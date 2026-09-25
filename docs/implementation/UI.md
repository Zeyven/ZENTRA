# Website + Desktop UI implementation — updated 2026-09-25

## Scope

用户在冻结白皮书后补充了官网与桌面的产品边界，并在设计提案后要求开始开发。本轮交付可运行的界面与交互层，保持 M0 的工程与能力状态真实。白皮书原件未修改；M1–M12 不因 UI 成形而视为完成。

## Implemented

- Website：Homepage、Product、Download、Security，共享品牌与响应式导航。首页遵循 Hero → What is AYRA / Chat Work Build → Why AYRA → Agent → Security → Download → Footer。
- Hero 使用 MacBook 中的 Desktop 产品示意。概览按钮打开三步可操作介绍，明确不是已录制视频。下载入口进入平台状态页；未发布安装包保持禁用。
- Desktop：七个任务入口与统一 Workspace / Search / Notification / Profile 顶栏。演示工作区按用户给出的四张参考图提供 Home、Chat、Work、Build、Projects 的示例内容，并以醒目标记区分真实数据。个人工作区保留真实空状态：Chat 和 Work 支持收起 Context；Build 默认 Preview，进度使用 Goal / Progress / Result；Projects 有 Overview / Resources / Tasks / Artifacts；Activity 有分类筛选。
- 基础组件：Button、Card、Navigation、Sidebar、CommandBar、ArtifactCard、TaskCard、ProjectCard。颜色、间距、字体、圆角和阴影来自共享 token 包。
- Desktop minWidth 900；官网单独处理移动端和平板。移动端 Companion 不复制桌面缩小版。
- Logo 从用户 ZIP 选择 charcoal 导航标和 porcelain 应用图标，保持原图形。

## Real behavior and limits

导航、搜索（含键盘选择）、菜单、概览、分类、草稿输入和上下文收起可操作。设置中的紧凑导航在当前应用会话中保留。Chat/Work 草稿分别保存在当前设备的应用数据中，离开页面或刷新后可以恢复；首页显示真实存在的本机草稿入口。支持复制与触发文本/Markdown 下载；本机存储失败时明确提示，并保留当前会话中的输入。Chat 笔记、Projects 中创建的本机项目及其任务也保存在此设备。用户可从首页进入指定项目，在项目中添加、完成任务；旧版无任务字段的本机项目按空任务列表读取。它们均没有账号同步或服务端持久化，也不会驱动 AI 执行。

正式项目服务、账户、任务执行、模型接入与安装包发布尚未实现。官网 Security 区分设计要求与实际发布证据，不宣称已经通过审计或全部本地处理。

## Verification

最新本地 `pnpm check` 的 lint、architecture boundaries、format、typecheck、48 项确定性测试及全部 workspace 构建通过。网站四个页面仍是唯一的官网路由；已移除的 Web 工作空间路由不恢复。浏览器交互和视觉证据见根目录 `design-qa.md`：项目与任务完整流程在隔离端口测试，用户的主预览数据没有被测试污染。原生平台验证由 GitHub Actions 独立执行；本次修改的原生 CI 结果需在提交后单独记录。

本地 Docker 基础设施按用户选择保持 NOT VERIFIED；未重新拉取镜像。未执行生产部署、数据库迁移或付费模型调用。
