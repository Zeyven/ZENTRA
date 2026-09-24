# @ayra/agent-runtime

M4 自有接口已定义：`AgentRuntime.run/resume/cancel`、带来源的 Context、Capability、Budget、ApprovalDecision 与可记录的 model/prompt version。`assertDelegatedCapabilities` 在委派前拒绝子 Agent 扩权。

OpenAI Agents SDK adapter、持久 checkpoint 和真实模型执行尚未实现；此包没有可运行的生产 Agent。
