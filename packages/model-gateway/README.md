# @ayra/model-gateway

M4 自有 ModelProvider 接口与 Auto / Fast / Balanced / Deep 选型骨架已定义。`selectModel` 先强制过滤 availability、region、privacy、capability、context 和估算预算，再按预设排序；没有合格模型时明确失败。

Catalog 分数和价格必须由服务端可信配置提供。真实供应商 adapter、凭据、用量结算与基于 Eval 的质量校准尚未实现；此包不能发起模型调用。
