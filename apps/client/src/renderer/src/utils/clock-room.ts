/** PostgreSQL numeric aggregates arrive as strings. Never concatenate clock totals. */
export function clockCount(value: unknown): number {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) && number >= 0 ? number : 0
}

export function clockStatus(status: string,serviceState?: string): {label: string; className: string} {
  if(status==='serving'){
    const pending:Record<string,string>={ASSIGNED:'待接单',READY:'待上钟',PAUSED:'服务暂停',ENDING_SOON:'即将到时',OVERTIME:'服务超时'}
    if(serviceState&&pending[serviceState])return {label:pending[serviceState],className:'bg-amber-50 text-amber-700'}
  }
  switch (status) {
    case 'on': return {label: '等待排钟', className: 'bg-amber-50 text-amber-700'}
    case 'serving': return {label: '上钟中', className: 'bg-blue-50 text-blue-700'}
    case 'rest': return {label: '休息中', className: 'bg-violet-50 text-violet-700'}
    case 'off': return {label: '已下班', className: 'bg-gray-100 text-gray-600'}
    default: return {label: '状态待确认', className: 'bg-red-50 text-red-700'}
  }
}
