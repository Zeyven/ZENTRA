export function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0)
  return '¥' + v.toFixed(2)
}

export function fmtNum(n: number | null | undefined): string {
  return Number(n ?? 0).toFixed(2)
}

// —— 金额输入解析 ——
// 注意：Number('') === 0 而不是 NaN。金额输入框可能是空串、纯空格或非数字，
// 若直接参与计算，空输入会被当成 0 参与运算（例如整单折扣空值 = 0 折 = 全额减免），
// 因此必须显式判空，不能依赖 Number() 的默认行为。
export function parseMoneyInput(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : Number.NaN
  if (typeof raw !== 'string') return Number.NaN
  const trimmed = raw.trim()
  if (trimmed === '') return Number.NaN
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : Number.NaN
}

export type DiscountType = 'scheme' | 'rate' | 'amount' | 'round' | 'free'

export interface DiscountInput {
  discType: DiscountType
  discValue?: string | number | null
  discAmount?: string | number | null
  subtotal: number | null | undefined
}

export interface DiscountResult {
  discount: number
  detail: string
}

// 计算折扣。任何非法输入都抛出可直接展示给收银员的错误，
// 绝不静默返回一个「合法但错误」的金额——空值曾经导致整单全额减免被静默落账。
export function computeDiscount({ discType, discValue, discAmount, subtotal }: DiscountInput): DiscountResult {
  const sub = Number(subtotal)
  if (!Number.isFinite(sub) || sub < 0) throw new Error('订单小计无效，请刷新订单后重试')

  let discount = 0
  let detail = ''
  if (discType === 'scheme') {
    discount = 0
  } else if (discType === 'rate') {
    const ratePercent = parseMoneyInput(discValue)
    if (!Number.isFinite(ratePercent)) throw new Error('请输入折扣，例如 88 表示 88 折')
    if (ratePercent <= 0 || ratePercent > 100) throw new Error('折扣需大于 0 且不超过 100（100 表示不打折）')
    discount = sub * (1 - ratePercent / 100)
    detail = `整单${ratePercent}折`
  } else if (discType === 'amount') {
    const amount = parseMoneyInput(discAmount)
    if (!Number.isFinite(amount)) throw new Error('请输入减免金额')
    if (amount <= 0) throw new Error('减免金额需大于 0')
    if (amount > sub) throw new Error('减免金额不能超过订单小计')
    discount = amount
    detail = `优惠${amount}元`
  } else if (discType === 'round') {
    discount = sub - Math.floor(sub)
    detail = '抹零'
  } else if (discType === 'free') {
    discount = sub
    detail = '免单'
  } else {
    throw new Error('折扣类型无效')
  }

  discount = Math.round(discount * 100) / 100
  discount = Math.max(0, Math.min(sub, discount))
  if (!Number.isFinite(discount)) throw new Error('折扣计算结果无效，请核对输入')
  return { discount, detail }
}

// 手机号脱敏：列表与详情默认只展示前 3 后 4，避免收银大屏批量泄露会员 PII。
// 需要完整号码时必须走显式动作（核对身份/发验证码）并受权限约束。
export function maskPhone(phone: string | null | undefined): string {
  const value = (phone ?? '').trim()
  if (value === '') return '-'
  if (value.length < 7) return '*'.repeat(value.length)
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

export function storeDateTime(ts?:string|null):string {
  if(!ts)return ''
  let value=ts.replace(' ','T');if(/^\d{4}-\d{2}-\d{2}$/.test(value))value+='T00:00:00'
  if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(value))value+='+08:00'
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return ''
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date)
}
export function fmtTime(ts?: string | null): string {return storeDateTime(ts).slice(11,16)||'-'}
export function fmtDateTime(ts?: string | null): string {return storeDateTime(ts).slice(5,16)||'-'}

export function today(): string {
  return storeDateTime(new Date().toISOString()).slice(0,10)
}

export function nowTime(): string {
  return fmtTime(new Date().toISOString())
}

// 计算已进行时长（分钟）。服务端无时区时间是门店本地时间，不能追加 Z 当成 UTC。
export function elapsedMinutes(startTs?: string | null, currentTimeMs = Date.now()): number {
  if (!startTs) return 0
  let normalized = startTs.replace(' ', 'T')
  if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized))normalized+='+08:00'
  const start = new Date(normalized).getTime()
  if (!Number.isFinite(start)) return 0
  const diff = currentTimeMs - start
  return Math.max(0, Math.floor(diff / 60000))
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${min}分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}小时${m}分` : `${h}小时`
}

export const ROLE_LABELS: Record<string, string> = {
  boss: '老板',
  manager: '店长',
  floor: '楼面/前台',
  technician: '技师'
}

export const ROOM_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  idle: { label: '空闲', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
  occupied: { label: '使用中', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-300' },
  cleaning: { label: '待打扫', color: 'text-sky-600', bg: 'bg-sky-50 border-sky-200' },
  reserved: { label: '已预约', color: 'text-violet-600', bg: 'bg-violet-50 border-violet-200' }
}

export const TECH_STATUS: Record<string, { label: string; color: string; dot: string }> = {
  off: { label: '未打卡', color: 'text-gray-500', dot: 'bg-gray-400' },
  on: { label: '待钟', color: 'text-emerald-600', dot: 'bg-emerald-500' },
  serving: { label: '上钟中', color: 'text-amber-600', dot: 'bg-amber-500' },
  rest: { label: '休息', color: 'text-sky-600', dot: 'bg-sky-500' }
}

export const PAY_METHODS = ['现金', '微信', '支付宝', '银行卡', '美团', '抖音', '会员卡']

export const CARD_TYPES: Record<string, string> = {
  storage: '储值卡',
  times: '次卡',
  discount: '打折卡'
}

export const TECH_LEVELS = ['技师', '普通', '金牌', '明星', '特级']

// 技师排序：上钟中(serving)排最后，其余按 queue_position，再按工号自然序
export function sortTechnicians<T extends { status: string; queue_position?: number | null; code?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const aServing = a.status === 'serving' ? 1 : 0
    const bServing = b.status === 'serving' ? 1 : 0
    if (aServing !== bServing) return aServing - bServing
    const aq = a.queue_position ?? 0
    const bq = b.queue_position ?? 0
    if (aq !== bq) return aq - bq
    return (a.code || '').localeCompare(b.code || '', undefined, { numeric: true })
  })
}
