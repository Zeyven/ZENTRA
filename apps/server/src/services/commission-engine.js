import {Decimal} from 'decimal.js'
const round2 = (value) => new Decimal(value || 0).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toNumber()

function jsonObject(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

function matches(rule, context) {
  if (context.serviceDate && ((rule.effective_from && context.serviceDate < rule.effective_from) || (rule.effective_to && context.serviceDate > rule.effective_to))) return false
  const c = jsonObject(rule.conditions)
  if (c.technician_ids?.length && !c.technician_ids.map(Number).includes(Number(context.technicianId))) return false
  if (c.technician_levels?.length && !c.technician_levels.includes(context.technicianLevel)) return false
  if (c.item_ids?.length && !c.item_ids.map(Number).includes(Number(context.itemId))) return false
  if (c.service_types?.length && !c.service_types.includes(context.serviceType)) return false
  if (c.min_amount != null && context.periodAmount < Number(c.min_amount)) return false
  if (c.max_amount != null && context.periodAmount > Number(c.max_amount)) return false
  if (c.min_count != null && context.periodCount < Number(c.min_count)) return false
  return true
}

/** @param {{rules?: any[], lines?: any[], fallback?: Record<string,number>}} input */
export function calculateCommission({ rules = [], lines = [], fallback = {} }) {
  const ordered = rules
    .filter((r) => Number(r.active) !== 0)
    .sort((a, b) => Number(a.priority) - Number(b.priority) || Number(a.id) - Number(b.id))
  const periodAmount = round2(lines.reduce((sum, line) => sum.plus(line.amount || 0), new Decimal(0)))
  const periodCount = lines.reduce((sum, line) => sum + (line.is_add_time ? 0 : Number(line.quantity || 1)), 0)
  const details = []
  let total = 0

  for (const line of lines) {
    const context = {
      technicianId: line.technician_id,
      technicianLevel: line.technician_level,
      itemId: line.item_id,
      serviceType: line.service_type || '轮钟',
      serviceDate: line.clock_out_at?.slice(0, 10),
      periodAmount,
      periodCount
    }
    const matched = ordered.filter((rule) => matches(rule, context))
    const applied = matched.filter((rule, index) => rule.stack_mode === 'stack' || index === 0)
    let lineCommission = new Decimal(0)

    if (applied.length) {
      for (const rule of applied) {
        const value = Number(rule.action_value) || 0
        if (rule.action_type === 'fixed') lineCommission = lineCommission.plus(new Decimal(value).mul(line.quantity || 1))
        else if (rule.action_type === 'bonus') lineCommission = lineCommission.plus(value)
        else lineCommission = lineCommission.plus(new Decimal(line.amount || 0).mul(value).div(100))
      }
    } else {
      const amount = Number(line.amount || 0)
      const rate = line.is_add_time && Number(fallback.addTimeRate) > 0
        ? Number(fallback.addTimeRate)
        : line.service_type === '点钟' && Number(fallback.dianzhongRate) > 0
          ? Number(fallback.dianzhongRate)
          : line.service_type === '半钟' && Number(fallback.halfRate) > 0
            ? Number(fallback.halfRate)
            : line.service_type === '轮钟' && Number(fallback.wheelRate) > 0
              ? Number(fallback.wheelRate)
              : Number(fallback.baseRate) || 0
      lineCommission = new Decimal(amount).mul(rate).div(100)
      if (line.service_type === '点钟') lineCommission = lineCommission.plus(fallback.dianzhongBonus || 0)
    }

    lineCommission = round2(lineCommission)
    total = round2(new Decimal(total).plus(lineCommission))
    details.push({
      line_id: line.id,
      item_id: line.item_id,
      amount: round2(line.amount),
      commission: lineCommission,
      rule_ids: applied.map((r) => r.id),
      fallback: applied.length === 0
    })
  }
  return { total, period_amount: periodAmount, period_count: periodCount, details }
}

export function validateCommissionRule(input) {
  const allowedActions = new Set(['rate', 'fixed', 'bonus'])
  const allowedStacks = new Set(['first', 'stack'])
  if (!String(input.name || '').trim()) throw new Error('规则名称不能为空')
  if (!allowedActions.has(input.action_type)) throw new Error('不支持的提成动作')
  if (!allowedStacks.has(input.stack_mode || 'first')) throw new Error('不支持的叠加方式')
  if (!Number.isFinite(Number(input.action_value)) || Number(input.action_value) < 0) throw new Error('提成值必须为非负数')
  const conditions = jsonObject(input.conditions)
  return { ...input, name: String(input.name).trim(), conditions }
}
