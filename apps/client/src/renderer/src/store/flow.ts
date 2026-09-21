// 跨页面轻量意图传递（无状态，仅内存）：看板右键技师 →「预约该技师」预选到预约页
let prebookTech: { id: number; name: string } | null = null

export function setPrebookTech(t: { id: number; name: string } | null): void {
  prebookTech = t
}

/** 预约页挂载时消费一次；返回 null 表示无预选 */
export function consumePrebookTech(): { id: number; name: string } | null {
  const v = prebookTech
  prebookTech = null
  return v
}
