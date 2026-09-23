# @ayra/auth

M1 正在实现 IdentityProvider 与 PolicyEngine 边界。Clerk 适配器只验证带有会话 ID 的 JWT；没有公钥和允许的来源时受保护 API 关闭。外部 subject 只用于服务端身份映射，Domain API 只返回 AYRA 自有 UUID。真实供应商凭据、会话轮换、设备管理和账户关联尚未验收。
