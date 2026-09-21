// 生成 UUID：优先用 crypto.randomUUID（HTTPS/localhost 安全上下文）；
// http://IP 等非安全上下文无此 API 时降级为随机串（避免收银面板白屏）
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
