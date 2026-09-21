import {Decimal} from 'decimal.js'
const round2 = (value) => new Decimal(value).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toNumber()

const normalizeDateTime = (value) => {
  const raw = String(value || '').trim().replace('T', ' ')
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/)
  if (!match) return null
  return { date: match[1], time: match[2] || '00:00' }
}

const parseWeekdays = (value) => {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parseWeekdays(parsed)
  } catch { /* comma separated value */ }
  return String(value).split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
}

const inTimeWindow = (time, start, end) => {
  if (!start && !end) return true
  if (start && !/^\d{2}:\d{2}$/.test(start)) return false
  if (end && !/^\d{2}:\d{2}$/.test(end)) return false
  if (!start) return time <= end
  if (!end) return time >= start
  if (start <= end) return time >= start && time <= end
  return time >= start || time <= end
}

export function validatePricingRule(input) {
  const name = String(input?.name || '').trim()
  const adjustmentType = String(input?.adjustment_type || '')
  const rawValue = input?.adjustment_value
  const adjustmentValue = Number(rawValue)
  const hasValue = rawValue !== '' && rawValue != null
  const stackMode = String(input?.stack_mode || 'stack')
  if (!name) return '请填写规则名称'
  if (!['fixed', 'percent', 'override'].includes(adjustmentType)) return '调价方式无效'
  if (!hasValue || !Number.isFinite(adjustmentValue)) return '调价值必须是数字'
  if (adjustmentType === 'percent' && adjustmentValue <= -100) return '百分比调整必须大于 -100%'
  if (adjustmentType === 'override' && adjustmentValue <= 0) return '指定成交价必须大于 0'
  if (!['stack', 'stop'].includes(stackMode)) return '叠加方式无效'
  const validTime = (value) => !value || (/^\d{2}:\d{2}$/.test(String(value)) && String(value) >= '00:00' && String(value) <= '23:59')
  if (!validTime(input?.start_time)) return '开始时间格式应为 HH:mm'
  if (!validTime(input?.end_time)) return '结束时间格式应为 HH:mm'
  const validDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))
  if (!validDate(input?.effective_from) || !validDate(input?.effective_to)) return '生效日期格式应为 YYYY-MM-DD'
  if (input?.effective_from && input?.effective_to && input.effective_from > input.effective_to) return '结束日期不能早于开始日期'
  const weekdays = parseWeekdays(input?.weekdays)
  if (input?.weekdays != null && input.weekdays !== '' && weekdays.length === 0) return '适用星期无效'
  return null
}

export function calculatePrice({ basePrice, rules, context }) {
  const base = round2(basePrice)
  const at = normalizeDateTime(context?.at)
  if (!Number.isFinite(base) || base < 0) throw new Error('项目基础价格无效')
  if (!at) throw new Error('计价时间无效')
  const weekday = new Date(`${at.date}T12:00:00`).getDay()
  let current = base
  const appliedRules = []

  for (const rule of [...(rules || [])].sort((a, b) => Number(a.priority ?? 100) - Number(b.priority ?? 100) || Number(a.id ?? 0) - Number(b.id ?? 0))) {
    if (!Number(rule.enabled)) continue
    if (rule.item_id != null && Number(rule.item_id) !== Number(context.item_id)) continue
    if (rule.effective_from && at.date < rule.effective_from) continue
    if (rule.effective_to && at.date > rule.effective_to) continue
    const weekdays = parseWeekdays(rule.weekdays)
    if (weekdays.length && !weekdays.includes(weekday)) continue
    if (!inTimeWindow(at.time, rule.start_time, rule.end_time)) continue
    if (rule.room_type && rule.room_type !== context.room_type) continue
    if (rule.technician_level && rule.technician_level !== context.technician_level) continue
    if (rule.member_level && rule.member_level !== context.member_level) continue

    const before = current
    const value = Number(rule.adjustment_value)
    if (rule.adjustment_type === 'fixed') current = new Decimal(current).plus(value).toNumber()
    else if (rule.adjustment_type === 'percent') current = new Decimal(current).mul(new Decimal(value).div(100).plus(1)).toNumber()
    else if (rule.adjustment_type === 'override') {
      if (!Number.isFinite(value) || value <= 0) continue
      current = value
    }
    current = Math.max(0, round2(current))
    appliedRules.push({ id: rule.id, name: rule.name, type: rule.adjustment_type, value, before: round2(before), after: current })
    if (rule.stack_mode === 'stop') break
  }

  return {
    base_price: base,
    final_price: current,
    calculated_at: String(context.at),
    context: {
      item_id: Number(context.item_id),
      room_type: context.room_type || null,
      technician_level: context.technician_level || null,
      member_level: context.member_level || null
    },
    applied_rules: appliedRules
  }
}
