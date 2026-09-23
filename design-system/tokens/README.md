# Foundations / Tokens · Proposal 0.1

以下为设计值，不是已发布的 token API。Implementation 阶段映射到 `packages/design-tokens`。

## Colors

| Token             | Value   | Use                          |
| ----------------- | ------- | ---------------------------- |
| canvas.warm       | #F7F6F2 | 官网基础背景                 |
| surface.default   | #FFFFFF | 内容与主面板                 |
| surface.subtle    | #F0F1EF | 桌面侧栏、轻层次             |
| surface.mist      | #EAF0F3 | 品牌局部环境                 |
| text.primary      | #202629 | 标题与主正文                 |
| text.secondary    | #5D6770 | 次级正文                     |
| text.tertiary     | #707A82 | 元信息，仍需按底色检查对比度 |
| border.subtle     | #E2E5E4 | 分隔，不围住所有内容         |
| action.primary    | #28383D | 主要按钮                     |
| action.on-primary | #FFFFFF | 深色按钮文字                 |
| focus.ring        | #356A96 | 2 px 键盘焦点                |
| accent.blue.soft  | #EAF2F8 | Research / 轻强调背景        |
| accent.lilac.soft | #F0ECF7 | Artifact / 轻强调背景        |
| accent.sand.soft  | #F7F0E7 | 内容分类背景                 |
| accent.green.soft | #EAF2EC | 已完成状态背景               |
| status.success    | #246443 | 成功文字/图标                |
| status.warning    | #87581E | 需要关注                     |
| status.error      | #A3323D | 失败文字/图标                |

Pastel 只作背景；正文使用深色语义前景。禁止 SaaS 蓝紫渐变、高饱和大面积底色和大面积玻璃层。正常文字目标对比度 4.5:1，大字号与非文本控件目标 3:1，最终用实际配对复核。

## Typography

两类字体，不叠加第三类品牌装饰字体：

- Editorial：Georgia / 系统 serif，官网主标题、少量文档标题。
- Interface：系统 sans-serif；macOS 为系统字体，Windows 使用 Segoe UI 回退。代码内容才使用系统 monospace。

| Role       | Website desktop | Website mobile | Desktop app        |
| ---------- | --------------- | -------------- | ------------------ |
| Hero       | 72/78, regular  | 42/48          | 不使用营销式大标题 |
| Page title | 48/56           | 32/40          | 26/34              |
| Section    | 32/40           | 26/34          | 18/26              |
| Body       | 18/28           | 16/26          | 14/22              |
| Secondary  | 14/22           | 14/22          | 13/20              |
| Metadata   | 12/18           | 12/18          | 12/18              |

标题字距约 -0.02em；正文保持自然字距。长段落最多约 65 字符宽，不通过缩小正文塞入更多卡片。

## Spacing / radii / shadows

间距基础：4、8、12、16、24、32、48、64、96、128 px。
官网区段：桌面 112–128 px，平板 80 px，移动 56–64 px；正文最大宽 1200 px。
桌面壳：Sidebar 208–224 px；Topbar 64 px；内容间距 16–24 px；上下文区约 300–340 px，可收起。

圆角：控件 8 px；内容容器 12 px；营销产品图 20 px；只对状态标签使用 pill。
阴影：页面正文与普通列表无阴影；卡片最多微弱 0 2 8 / 4%；浮层 0 12 32 / 12%。

## Motion / accessibility

Hover/pressed 120–160 ms；面板切换 180–220 ms。主要内容不能用持续动画吸引注意。尊重 reduced motion；加载状态可用文字与静态进度说明。
网站交互目标至少 44 × 44 px；桌面密集工具栏可较紧凑但需清晰命中区域与可见焦点。禁用、失败、进行中状态不只依赖颜色表达。
