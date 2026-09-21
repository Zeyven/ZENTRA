import { useCallback, useMemo, useState } from 'react'
import { api } from '../api'
import type { Order } from '../types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { fmtMoney, fmtDateTime, today } from '../utils/format'
import { Badge, EmptyState } from '../components/ui'
import CashierPanel from '../components/CashierPanel'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

const STATUS_TABS = [
  { k: 'open', label: '进行中' },
  { k: 'suspended', label: '挂单' },
  { k: 'closed', label: '已结账' },
  { k: 'cancelled', label: '已取消' },
  { k: '', label: '全部' }
]

export default function Orders(): JSX.Element {
  const user = useAuth((s) => s.user)!
  const [orders, setOrders] = useState<Order[]>([])
  const [status, setStatus] = useState('open')
  const [date, setDate] = useState('')
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      setOrders(await api.listOrders(status || undefined, date || undefined))
    } catch (e) {
      toast(e instanceof Error ? e.message : '账单加载失败', 'error')
    }
  }, [status, date])


  useAutoRefresh(load)
  const visibleOrders = useMemo(() => {
    const key = query.trim().toLocaleLowerCase()
    return orders.filter(o => !key || [o.order_no, o.room_name, o.wristband_no, o.customer_name, o.member_name, o.technician_name].some(value => value?.toLocaleLowerCase().includes(key)))
  }, [orders, query])

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <h2 className="text-lg font-bold text-gray-800">账单管理</h2>
        <div className="flex items-center gap-2">
          <input className="input w-60" aria-label="搜索当前列表账单" placeholder="单号 / 房间 / 客户 / 技师" value={query} onChange={e => setQuery(e.target.value)} />
          <input aria-label="账单日期" className="input w-40" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn-secondary" onClick={() => setDate(today())}>今天</button>
          {date && <button className="btn-ghost" onClick={() => setDate('')}>全部日期</button>}
        </div>
      </header>
      <div className="px-5 py-3 flex gap-2 flex-wrap items-center">
        {STATUS_TABS.map((s) => (
          <button
            key={s.k}
            aria-pressed={status === s.k}
            className={`px-4 py-1.5 rounded-full text-sm ${status === s.k ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
            onClick={() => setStatus(s.k)}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500">当前列表 {visibleOrders.length} 笔 · 最多显示最近 500 笔</span>
      </div>
      <div className="flex-1 overflow-auto px-5 pb-5">
        <div className="card overflow-hidden">
          <table className="table w-full">
            <thead>
              <tr>
                <th>单号</th>
                <th>房间</th>
                <th>客户</th>
                <th>技师</th>
                <th>开单时间</th>
                <th>折前</th>
                <th>实收</th>
                <th>待收</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="font-mono text-xs">{o.order_no}</td>
                  <td>{o.room_name || o.wristband_no || '-'}</td>
                  <td>{o.customer_name || o.member_name || '-'}</td>
                  <td>{o.technician_name || '-'}</td>
                  <td>{fmtDateTime(o.opened_at)}</td>
                  <td>{fmtMoney(o.subtotal)}</td>
                  <td className="font-semibold">{fmtMoney(o.paid)}</td>
                  <td>{o.status === 'cancelled' ? '不适用' : fmtMoney(Math.max(0, o.payable - o.paid))}</td>
                  <td>
                    {o.status === 'open' ? <Badge text="进行中" className="bg-amber-50 text-amber-600" /> : o.status === 'suspended' ? <Badge text="挂单" className="bg-violet-50 text-violet-600" /> : o.status === 'closed' ? <Badge text="已结账" className="bg-emerald-50 text-emerald-600" /> : <Badge text="已取消" className="bg-gray-100 text-gray-500" />}
                  </td>
                  <td>
                    <div className="flex gap-2 items-center">
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => setActiveId(o.id)}>
                        {o.status === 'suspended' ? '查看' : '查看/操作'}
                      </button>
                      {o.status === 'suspended' && (
                        <button
                          className="text-xs text-violet-600 hover:underline"
                          onClick={async () => {
                            const res = await api.resumeOrder({ order_id: o.id }, user.id)
                            if (res.ok) {
                              toast(`已恢复 ${o.order_no}`)
                              await load()
                            } else {
                              toast(res.msg || '恢复失败（原房间可能已占用）', 'error')
                            }
                          }}
                        >
                          恢复
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleOrders.length === 0 && <EmptyState text={query ? '没有匹配的账单，请调整搜索条件' : '暂无账单'} />}
        </div>
      </div>

      {activeId && (
        <CashierPanel key={activeId}
          orderId={activeId}
          onClose={async () => {
            setActiveId(null)
            await load()
          }}
        />
      )}
    </div>
  )
}
