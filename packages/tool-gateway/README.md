# @ayra/tool-gateway

M5 的 Tool Gateway 边界已实现：先用注入式 Run Identity resolver 取得 canonical 身份与能力，再核验工具版本、参数、Capability 和资源范围、工具自身授权与 Policy；可逆写入要求 snapshot 与幂等键，外部写入/高风险动作要求精确 Approval，高风险还要求独立验证。通过门控后才从 Vault adapter 取得短期凭据，工具结果经显式 sanitizer 才能返回给 Agent。尝试和结果交给注入式 Audit adapter。

当前没有注册生产工具，也没有数据库 Approval 消费、真实 Vault、Policy 或 Audit adapter。此包是拒绝未授权调用的执行边界，**不能单独使外部操作可用**。Approval 消费和外部操作需要同一幂等/恢复设计，才能在崩溃后安全重试。
