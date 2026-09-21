import {canOperate} from '../utils/permissions'
import { useCallback, useRef, useState } from 'react'
import { api } from '../api'
import type { Shift } from '../types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { fmtMoney, fmtDateTime } from '../utils/format'
import { Modal, StatCard, EmptyState, Badge } from '../components/ui'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

export default function Shift(): JSX.Element {
  const user = useAuth((s) => s.user)!
  const [current, setCurrent] = useState<Shift | null>(null)
  const [history, setHistory] = useState<Shift[]>([])
  const [startCash, setStartCash] = useState(0)
  const [endNote, setEndNote] = useState('')
  const [actualCash,setActualCash]=useState(''),[endUnknown,setEndUnknown]=useState(false)
  const endPending=useRef<{note:string;actual:number;expected:number;shift:number}|null>(null)
  const [showStart, setShowStart] = useState(false)
  const [showEnd, setShowEnd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const sequence = useRef(0)

  const load = useCallback(async () => {
    const request = ++sequence.current
    try {
      const [next, rows] = await Promise.all([api.currentShift(user.id), api.listShifts()])
      if (request === sequence.current) { setCurrent(next); setHistory(rows); setError('') }
    } catch (e) { if (request === sequence.current) setError(e instanceof Error ? e.message : '交班数据加载失败，请刷新后重试') }
  }, [user.id])


  useAutoRefresh(load)

  const start = async (): Promise<void> => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
    const res = await api.startShift(startCash, user.id)
    if (res.ok) {
      toast('新班次已开始')
      setShowStart(false)
      await load()
    } else {
      toast(res.msg || '操作失败', 'error')
    }
    } catch (e) { toast(e instanceof Error ? e.message : '开始班次失败', 'error') }
    finally { running.current = false; setBusy(false) }
  }

  const end = async (): Promise<void> => {
    if (running.current) return
    if(!endPending.current){
      if(!actualCash.trim()||!Number.isFinite(Number(actualCash))||Number(actualCash)<0||!current){toast('请填写实点现金金额','error');return}
      endPending.current={note:endNote,actual:Number(actualCash),expected:current.expected_cash,shift:current.id}
    }
    running.current = true
    setBusy(true)
    try {
    const pending=endPending.current!
    const res = await api.endShift(pending.note, user.id,pending.actual,pending.expected,pending.shift)
    if (res.ok) {
      endPending.current=null;setEndUnknown(false);toast('交接班完成')
      setShowEnd(false)
      await load()
    } else {setEndUnknown(res.code==='RESULT_UNKNOWN');if(res.code!=='RESULT_UNKNOWN'){endPending.current=null;if(res.code==='SHIFT_CHANGED')await load()}toast(res.msg || '交接失败', 'error')}
    } catch (e) { setEndUnknown(true);toast(e instanceof Error ? e.message : '交接结果未确认', 'error') }
    finally { running.current = false; setBusy(false) }
  }

  const methods: { k: keyof Shift; label: string }[] = [
    { k: 'total_cash', label: '现金' },
    { k: 'total_wechat', label: '微信' },
    { k: 'total_alipay', label: '支付宝' },
    { k: 'total_card', label: '银行卡' },
    { k: 'total_meituan', label: '美团' },
    { k: 'total_douyin', label: '抖音' },
    { k: 'total_member', label: '会员卡' }
  ]

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <h2 className="text-lg font-bold text-gray-800">交接班</h2>
        <div className="flex gap-2">
          {!current ? (
            <button className="btn-primary" onClick={() => { setStartCash(0); setShowStart(true) }} disabled={!canOperate(user,'shiftManage')}>▶ 开始交班</button>
          ) : (
            <button className="btn-danger" onClick={() => {setActualCash('');setEndNote('');setShowEnd(true)}} disabled={!canOperate(user,'shiftManage')}>⏹ 结束交班</button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <p className="text-xs text-gray-500">各渠道结账净额含本班冲销，充值和押金单列。应交现金包含备用金、现金消费、现金充值与押金净收退。未开班流水仍保留在营业报表；跨班冲销记入操作班次，已交接快照保持不变。</p>
        {current ? (
          <div className="space-y-3">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-gray-700">当前班次</div>
                  <div className="text-xs text-gray-400">开始于 {fmtDateTime(current.start_at)} · {current.cashier_name || '收银员'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge text="进行中" className="bg-emerald-50 text-emerald-600" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="备用金" value={fmtMoney(current.start_cash)} />
                <StatCard label="会员充值净额（单列）" value={fmtMoney(current.total_recharge)} />
                <StatCard label="反结账冲销金额" value={fmtMoney(current.total_refund)} />
                <StatCard label="营业额(折前)" value={fmtMoney(current.total_sales)} />
                <StatCard label="实收合计" value={fmtMoney(current.total_cash + current.total_wechat + current.total_alipay + current.total_card + current.total_meituan + current.total_douyin + current.total_member)} accent="text-brand-600" />
                <StatCard label="应交现金" value={fmtMoney(current.expected_cash)} accent="text-emerald-600" />
                <StatCard label="手牌押金净额" value={fmtMoney(current.deposit_net)} />
                <StatCard label="预约订金净额" value={fmtMoney(current.booking_deposit_net)} />
              </div>
              <div className="mt-4 border-t pt-3"><div className="text-sm font-semibold mb-2">全部外部资金净额（含充值与押金）</div><div className="flex flex-wrap gap-4">{Object.entries(current.net_external).map(([method,amount])=><span key={method}>{method} {fmtMoney(amount)}</span>)}</div></div>
            </div>
            <div className="card p-4">
              <div className="text-sm font-semibold text-gray-700 mb-3">各支付方式收款</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {methods.map((m) => (
                  <div key={m.k} className="border border-gray-100 rounded-lg p-3">
                    <div className="text-xs text-gray-500">{m.label}</div>
                    <div className="text-lg font-bold text-gray-800">{fmtMoney(current[m.k] as number)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="card p-10 text-center text-gray-400">
            <div className="text-4xl mb-3">🕐</div>
            <p className="mb-4">当前没有进行中的班次</p>
            <button className="btn-primary" onClick={() => { setStartCash(0); setShowStart(true) }} disabled={!canOperate(user,'shiftManage')}>开始新班次</button>
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">历史交接班记录</div>
          <table className="table w-full">
            <thead><tr><th>班次</th><th>收银员</th><th>开始</th><th>结束</th><th>营业额</th><th>实收</th><th>实点现金</th><th>现金差异</th><th>状态</th><th>交接备注</th></tr></thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id}>
                  <td>#{s.id}</td>
                  <td>{s.cashier_name || '-'}</td>
                  <td>{fmtDateTime(s.start_at)}</td>
                  <td>{fmtDateTime(s.end_at)}</td>
                  <td>{fmtMoney(s.total_sales)}</td>
                  <td className="font-semibold">{fmtMoney(s.total_cash + s.total_wechat + s.total_alipay + s.total_card + s.total_meituan + s.total_douyin + s.total_member)}</td>
                  <td>{s.actual_cash==null?'未盘点':fmtMoney(s.actual_cash)}</td><td className={s.cash_difference?'text-red-700':''}>{s.cash_difference==null?'未核对':fmtMoney(s.cash_difference)}</td>
                  <td>{s.status === 'open' ? <Badge text="进行中" className="bg-emerald-50 text-emerald-600" /> : <Badge text="已交接" className="bg-gray-100 text-gray-500" />}</td>
                  <td>{s.handover_note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length === 0 && <EmptyState text="暂无记录" />}
        </div>
      </div>

      <Modal
        open={showStart}
        title="开始新班次"
        onClose={() => { if (!running.current) setShowStart(false) }}
        footer={<><button className="btn-secondary" onClick={() => setShowStart(false)}>取消</button><button className="btn-primary" disabled={(busy || Boolean(error))||!canOperate(user,'shiftManage')} onClick={start}>{busy ? '处理中…' : '开始'}</button></>}
      >
        <label className="label">交接备用金</label>
        <input className="input" type="number" value={startCash} onChange={(e) => setStartCash(Number(e.target.value))} />
      </Modal>

      <Modal
        open={showEnd}
        title="结束交接班"
        onClose={() => { if (!running.current&&!endUnknown) setShowEnd(false) }}
        footer={<><button className="btn-secondary" disabled={busy||endUnknown} onClick={() => setShowEnd(false)}>取消</button><button className="btn-danger" disabled={(busy || Boolean(error))||!canOperate(user,'shiftManage')} onClick={end}>{busy ? '处理中…' : endUnknown?'核对原交接结果':'确认交接'}</button></>}
      >
        {current && <p className="mb-3 font-semibold">本班应交现金：{fmtMoney(current.expected_cash)}</p>}
        <label className="label" htmlFor="actual-shift-cash">实点现金（元）</label><input id="actual-shift-cash" className="input" type="number" min="0" step="0.01" disabled={busy||endUnknown} value={actualCash} onChange={e=>setActualCash(e.target.value)}/>{endUnknown&&<p role="alert">交接结果未确认，请核对原请求，不要再次填写新金额。</p>}<label className="label">交接备注 / 差异原因</label>
        <textarea disabled={busy||endUnknown} className="input" rows={3} value={endNote} onChange={(e) => setEndNote(e.target.value)} placeholder="填写交接说明（可选）" />
      </Modal>
    </div>
  )
}
