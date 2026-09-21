import ReportEntries from '../components/ReportEntries'
import {usePageTab} from '../hooks/usePageTab'
import {can,canOperate} from '../utils/permissions'
import {useAuth} from '../store/auth'
import { useCallback, useRef, useState } from 'react'
import { api } from '../api'
import { fmtMoney, fmtNum, today } from '../utils/format'
import { exportCsv } from '../utils/exportCsv'
import { StatCard, EmptyState, Modal, AsyncButton } from '../components/ui'
import { toast } from '../store/toast'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

type Tab = 'daily' | 'tech' | 'member' | 'flow' | 'verify' | 'salary' | 'room' | 'cashier' | 'analysis' | 'growth'

// 本地时区日期格式化与偏移（避免 UTC 时区漂移）
function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function shiftDays(base: string, days: number): string {
  const d = new Date(base + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return fmtDate(d)
}
// 快捷日期范围
function quickRange(kind: 'today' | 'yesterday' | 'thisMonth' | 'lastMonth' | 'thisYear'): [string, string] {
  const t = today()
  const now = new Date(t + 'T12:00:00')
  if (kind === 'today') return [t, t]
  if (kind === 'yesterday') { const y = shiftDays(t, -1); return [y, y] }
  if (kind === 'thisMonth') return [`${t.slice(0, 7)}-01`, t]
  if (kind === 'lastMonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    return [fmtDate(first), fmtDate(last)]
  }
  // thisYear
  return [`${t.slice(0, 4)}-01-01`, t]
}

// 各 tab 导出 CSV
function doExport(tab: Tab, date: string, data: any): void {
  if(!can(useAuth.getState().user,'export')){toast('当前账号未授权导出数据','error');return}
  const prefix = `报表-${tab}-${date}`
  try {
    if (tab === 'daily' && data?.payStats) {
      exportCsv(`${prefix}-支付汇总.csv`, ['支付方式', '金额'], data.payStats.map((p: any) => [p.method, p.amount]))
      exportCsv(`${prefix}-项目销量.csv`, ['名称', '数量', '金额'], data.itemStats.map((i: any) => [i.item_name, i.cnt, i.amount]))
    } else if (tab === 'tech') {
      exportCsv(`${prefix}-技师业绩.csv`, ['排名', '技师', '等级', '服务单数', '钟数', '服务金额', '底薪', '提成', '合计薪资'], data.map((t: any, idx: number) => [idx + 1, `${t.code}号 ${t.name}`, t.level, t.served_orders, t.served_count, t.service_amount, t.base_salary, t.commission, t.salary]))
    } else if (tab === 'member') {
      exportCsv(`${prefix}-会员报表.csv`, ['会员', '卡号', '累计充值', '累计消费', '当前余额', '次卡'], data.map((m: any) => [m.name, m.card_no, m.recharge, m.consume, m.balance, m.times_balance]))
    } else if (tab === 'flow') {
      exportCsv(`${prefix}-客流.csv`, ['时段', '订单数'], data.map((f: any) => [f.day !== undefined ? f.day : `${f.hour}:00`, f.cnt]))
    } else if (tab === 'verify' && data?.list) {
      exportCsv(`${prefix}-团购核销.csv`, ['时间', '单号', '平台', '券码', '金额', '顾客'], data.list.map((v: any) => [v.paid_at, v.order_no, v.method, v.voucher_code, v.amount, v.customer_name]))
    } else if (tab === 'salary' && data?.list) {
      exportCsv(`${prefix}-员工工资.csv`, ['排名', '技师', '等级', '底薪', '提成率', '服务金额', '钟数', '提成', '合计工资'], data.list.map((t: any, idx: number) => [idx + 1, `${t.code}号 ${t.name}`, t.level, t.base_salary, `${t.commission_rate}%`, t.service_amount, t.served_cnt, t.commission, t.salary]))
    } else if (tab === 'room' && data?.list) {
      exportCsv(`${prefix}-房间报表.csv`, ['房间', '当前状态', '使用次数', '平均时长(分钟)', '营收'], data.list.map((r: any) => [r.room_no, r.status, r.used_count, r.avg_minutes, r.revenue]))
    } else if (tab === 'cashier' && data) {
      exportCsv(`${prefix}-收银员报表.csv`, ['收银员', '订单数', '收款金额', '优惠减免', '支付方式明细'], data.map((c: any) => [c.name || c.username, c.order_count, c.revenue, c.discount_total, (c.payments || []).map((p: any) => `${p.method}:${p.amount}`).join(' / ')]))
    } else if (tab === 'analysis' && data) {
      exportCsv(`${prefix}-营收趋势.csv`, ['日期', '营收', '订单数'], (data.trend || []).map((t: any) => [t.day, t.revenue, t.orders]))
      exportCsv(`${prefix}-项目TOP.csv`, ['项目', '次数', '金额'], (data.itemTop || []).map((i: any) => [i.item_name, i.cnt, i.amount]))
      exportCsv(`${prefix}-技师TOP.csv`, ['技师', '钟数', '金额'], (data.techTop || []).map((t: any) => [`${t.code}号 ${t.name}`, t.cnt, t.amount]))
      exportCsv(`${prefix}-支付占比.csv`, ['方式', '笔数', '金额'], (data.payShare || []).map((p: any) => [p.method, p.cnt, p.amount]))
    } else if (tab === 'growth' && data) {
      exportCsv(`${prefix}-营销ROI.csv`, ['活动', '触发', '发券', '核销', '核销率', '优惠成本', '归因营收', 'ROI'], (data.campaigns || []).map((c: any) => [c.name, c.triggered_count, c.issued_count, c.used_count, `${c.redemption_rate}%`, c.discount_amount, c.attributed_revenue, c.roi ?? '—']))
    }
  } catch {
    toast('导出失败，请刷新报表后重试', 'error')
  }
}

export default function Reports(): JSX.Element {
  const [entryRange,setEntryRange]=useState<{start:string;end:string}|null>(null)
  const user=useAuth(s=>s.user)!
  const [tab, setTab] = usePageTab<Tab>('daily',['daily','tech','member','flow','verify','salary','room','cashier','analysis','growth'])
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState(today())
  const [daily, setDaily] = useState<any>(null)
  const [techs, setTechs] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [memberSummary, setMemberSummary] = useState<any>(null)
  const [showWake, setShowWake] = useState(false)
  const [wakeForm, setWakeForm] = useState({ name: '老友回归唤醒券', value: 50, min_amount: 100, expire_days: 30, threshold_days: 30 })
  const [flow, setFlow] = useState<any[]>([])
  const [verifications, setVerifications] = useState<{ list: any[]; summary: any[]; refunds: any[]; refundTotal: number }>({ list: [], summary: [], refunds: [], refundTotal: 0 })
  const [salaries, setSalaries] = useState<{ month: string; list: any[] }>({ month: '', list: [] })
  const [payrollLocked, setPayrollLocked] = useState(false)
  const [roomReport, setRoomReport] = useState<any>(null)
  const [cashierReport, setCashierReport] = useState<any[]>([])
  const [analysis, setAnalysis] = useState<any>(null)
  const [growth, setGrowth] = useState<any>(null)
  const [brief, setBrief] = useState<any>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadedKey, setLoadedKey] = useState('')
  const sequence = useRef(0)
  const queryKey = `${tab}:${startDate}:${endDate}`

  const load = useCallback(async () => {
    const request = ++sequence.current
    if (!startDate || !endDate || startDate > endDate) { setLoadError('请选择有效日期，开始日期不能晚于结束日期'); setLoading(false); return }
    setLoading(true)
    try {
      let result: any
      if (tab === 'daily') result = await api.dailyReport(startDate, endDate)
      else if (tab === 'tech') result = await api.technicianReport(startDate, endDate)
      else if (tab === 'member') result = await api.memberReport(startDate, endDate)
      else if (tab === 'flow') result = await api.flowReport(startDate, endDate)
      else if (tab === 'verify') result = await api.verificationReport(startDate, endDate)
      else if (tab === 'salary') result = await Promise.all([api.salaryReport(startDate.slice(0, 7)), api.payrollSnapshot(startDate.slice(0, 7))])
      else if (tab === 'room') result = await api.roomReport(startDate, endDate)
      else if (tab === 'cashier') result = await api.cashierReport(startDate, endDate)
      else if (tab === 'analysis') result = await api.analysisReport(14)
      else result = await Promise.all([api.growthReport(startDate, endDate), api.executiveBrief(endDate)])
      if (request !== sequence.current) return
      if (tab === 'daily') setDaily(result)
      else if (tab === 'tech') setTechs(result?.list || [])
      else if (tab === 'member') { setMembers(result?.list || []); setMemberSummary(result?.summary || null) }
      else if (tab === 'flow') setFlow(result?.list || [])
      else if (tab === 'verify') setVerifications({ list: result?.list || [], summary: result?.summary || [], refunds: result?.refunds || [], refundTotal: result?.refundTotal || 0 })
      else if (tab === 'salary') { setSalaries(result[0]); setPayrollLocked(Boolean(result[1]?.locked)) }
      else if (tab === 'room') setRoomReport(result)
      else if (tab === 'cashier') setCashierReport(result?.list || [])
      else if (tab === 'analysis') setAnalysis(result)
      else { setGrowth(result[0]); setBrief(result[1]) }
      setLoadedKey(`${tab}:${startDate}:${endDate}`); setLoadError('')
    } catch (error) {
      if (request === sequence.current) setLoadError(error instanceof Error ? error.message : '报表加载失败')
    } finally { if (request === sequence.current) setLoading(false) }
  }, [tab, startDate, endDate])

  useAutoRefresh(load)

  const tabs: { k: Tab; label: string }[] = [
    { k: 'daily', label: '营业日报' },
    { k: 'tech', label: '技师业绩' },
    { k: 'member', label: '会员报表' },
    { k: 'flow', label: '客流统计' },
    { k: 'verify', label: '团购核销' },
    { k: 'salary', label: '员工工资' },
    { k: 'room', label: '房态报表' },
    { k: 'cashier', label: '收银汇总' },
    { k: 'analysis', label: '经营分析' },
    { k: 'growth', label: '增长简报' }
  ]

  return (
    <div className="h-full flex flex-col">
      <Modal open={!!entryRange} title="报表原始流水" width="max-w-6xl" onClose={()=>setEntryRange(null)}>{entryRange&&<ReportEntries key={entryRange.start+entryRange.end} start={entryRange.start} end={entryRange.end}/>}</Modal>
      <header className="bg-white border-b border-gray-200 flex flex-col px-5 py-3 shrink-0 gap-3">
        <div className="flex items-start gap-4 min-w-0">
          <h2 className="text-lg font-bold text-gray-800 whitespace-nowrap shrink-0">报表中心</h2>
          <div className="flex flex-wrap gap-1 bg-gray-100 rounded-lg p-1 min-w-0">
            {tabs.map((t) => (
              <button key={t.k} aria-pressed={tab === t.k} className={`px-4 py-1.5 rounded-md text-sm whitespace-nowrap shrink-0 ${tab === t.k ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`} onClick={() => setTab(t.k)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap"><button className="btn-secondary" disabled={loading||!!loadError||loadedKey!==queryKey} onClick={()=>setEntryRange({start:startDate,end:endDate})}>查看原始记账流水</button>
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {([['today', '今天'], ['yesterday', '昨天'], ['thisMonth', '本月'], ['lastMonth', '上月'], ['thisYear', '今年']] as const).map(([k, label]) => (
              <button
                key={k}
                className={`px-2.5 py-1 rounded-md text-xs ${startDate === quickRange(k as any)[0] && endDate === quickRange(k as any)[1] ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => { const [s, e] = quickRange(k as any); setStartDate(s); setEndDate(e) }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input aria-label="报表开始日期" className="input w-36" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <span className="text-gray-400 text-sm">至</span>
            <input aria-label="报表结束日期" className="input w-36" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <button
            className="btn-secondary"
            disabled={loading || !!loadError || loadedKey !== queryKey || !can(user,'export')}
            onClick={() => {
              const data = tab === 'daily' ? daily : tab === 'tech' ? techs : tab === 'member' ? members : tab === 'flow' ? flow : tab === 'verify' ? verifications : tab === 'salary' ? salaries : tab === 'room' ? roomReport : tab === 'cashier' ? cashierReport : tab === 'growth' ? growth : analysis
              doExport(tab, startDate === endDate ? startDate : `${startDate}~${endDate}`, data)
            }}
          >
            📥 导出 CSV
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-5 py-4">
        {loadError && <div role="alert" className="text-red-600 mb-3">{loadError}；下方如有数据，为此前加载结果。<button className="btn-secondary ml-2" onClick={load}>重试</button></div>}
        {!loadError && (loading || loadedKey !== queryKey) && <p role="status" className="text-gray-500 mb-3">正在加载所选报表，请稍候…</p>}
        {tab === 'analysis' && <p className="text-xs text-gray-500 mb-3">经营分析固定统计最近 14 天，不随上方日期筛选改变。</p>}
        {tab === 'daily' && <p className="text-xs text-gray-500 mb-3">按北京时间统计实际结账及冲销流水。充值和押金单列；客流按开房日期统计组数。</p>}
        {tab === 'daily' && daily && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard label="营业净额" value={fmtMoney(daily.sales.total_payable)} accent="text-brand-600" sub={`结账 ${daily.sales.order_count} 笔 / 冲销 ${daily.sales.reversal_count} 笔`} />
              <StatCard label="每笔结账净额" value={fmtMoney(daily.sales.avg_price)} sub="含当期冲销的净额 ÷ 结账笔数" />
              <StatCard label="到店客流" value={`${daily.sales.customer_flow} 组`} sub={`按开房日 / 进行中 ${daily.sales.open_count} 单`} />
              <StatCard
                label="环比上期"
                value={daily.compare?.payable_change_pct == null ? '—' : `${daily.compare.payable_change_pct >= 0 ? '+' : ''}${daily.compare.payable_change_pct}%`}
                accent={daily.compare?.payable_change_pct == null ? 'text-gray-500' : daily.compare.payable_change_pct >= 0 ? 'text-red-500' : 'text-emerald-600'}
                sub={`上期 ${fmtMoney(daily.compare?.prev_payable || 0)}`}
              />
              <StatCard label="折前营业额" value={fmtMoney(daily.sales.total_sales)} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="团购收入" value={fmtMoney(daily.channel?.团购 || 0)} accent="text-sky-600" sub="美团/抖音" />
              <StatCard label="会员卡消费" value={fmtMoney(daily.channel?.会员 || 0)} accent="text-emerald-600" />
              <StatCard label="线下收款" value={fmtMoney(daily.channel?.线下 || 0)} accent="text-violet-600" sub="现金/微信/支付宝/银行卡" />
              <StatCard label="会员充值" value={fmtMoney(daily.rechargeTotal)} accent="text-emerald-600" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="优惠减免" value={fmtMoney(daily.sales.total_discount)} accent="text-red-500" />
              <StatCard label="收款冲回" value={fmtMoney(daily.refundTotal)} accent="text-amber-600" />
              <StatCard label="手牌押金收取" value={fmtMoney(daily.depositCollected)} accent="text-sky-600" />
              <StatCard label="押金已退还" value={fmtMoney(daily.depositRefunded)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="card p-4">
                <div className="text-sm font-semibold text-gray-700 mb-3">支付方式汇总</div>
                <table className="table w-full">
                  <thead><tr><th>方式</th><th>金额</th></tr></thead>
                  <tbody>
                    {daily.payStats.map((p: any) => (
                      <tr key={p.method}><td>{p.method}</td><td className="font-semibold">{fmtMoney(p.amount)}</td></tr>
                    ))}
                    {daily.payStats.length === 0 && <tr><td colSpan={2} className="text-gray-400 text-center py-4">暂无数据</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="card p-4">
                <div className="text-sm font-semibold text-gray-700 mb-3">项目/商品销量</div>
                <table className="table w-full">
                  <thead><tr><th>名称</th><th>数量</th><th>金额</th></tr></thead>
                  <tbody>
                    {daily.itemStats.slice(0, 10).map((i: any) => (
                      <tr key={i.item_name}><td>{i.item_name}</td><td>{i.cnt}</td><td className="font-semibold">{fmtMoney(i.amount)}</td></tr>
                    ))}
                    {daily.itemStats.length === 0 && <tr><td colSpan={3} className="text-gray-400 text-center py-4">暂无数据</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'tech' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <StatCard label="技师人数" value={`${techs.length} 人`} />
              <StatCard label="服务总钟数" value={`${techs.reduce((s, t) => s + (t.served_count || 0), 0)} 钟`} />
              <StatCard label="点钟合计" value={`${techs.reduce((s, t) => s + (t.dianzhong_count || 0), 0)} 个`} />
              <StatCard label="加钟合计" value={`${techs.reduce((s, t) => s + (t.add_time_count || 0), 0)} 次`} />
              <StatCard label="提成合计" value={fmtMoney(techs.reduce((s, t) => s + (t.commission || 0), 0))} accent="text-brand-600" />
              <StatCard label="薪资合计" value={fmtMoney(techs.reduce((s, t) => s + (t.salary || 0), 0))} accent="text-emerald-600" />
            </div>
            <div className="card overflow-hidden">
              <table className="table w-full">
                <thead><tr><th>排名</th><th>技师</th><th>等级</th><th>服务单数</th><th>点钟</th><th>加钟</th><th>加项率</th><th>钟数</th><th>客单价</th><th>服务金额</th><th>底薪</th><th>提成</th><th>合计薪资</th></tr></thead>
                <tbody>
                  {techs.map((t, idx) => (
                    <tr key={t.id}>
                      <td>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${idx === 0 ? 'bg-amber-100 text-amber-700' : idx === 1 ? 'bg-gray-200 text-gray-700' : idx === 2 ? 'bg-orange-100 text-orange-700' : 'text-gray-500'}`}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="font-medium">{t.code}号 {t.name}</td>
                      <td>{t.level}</td>
                      <td>{t.served_orders}</td>
                      <td className="text-sky-600">{t.dianzhong_count || 0}{t.dianzhong_bonus_total ? <span className="text-xs text-gray-400">（奖¥{t.dianzhong_bonus_total}）</span> : ''}</td>
                      <td className="text-violet-600">{t.add_time_count || 0}</td>
                      <td>{t.add_item_rate ? `${t.add_item_rate}%` : '-'}</td>
                      <td>{t.served_count || 0}</td>
                      <td>{fmtMoney(t.avg_price)}</td>
                      <td>{fmtMoney(t.service_amount)}</td>
                      <td>{fmtMoney(t.base_salary)}</td>
                      <td className="text-brand-600">{fmtMoney(t.commission)}</td>
                      <td className="font-semibold text-emerald-600">{fmtMoney(t.salary)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {techs.length === 0 && <EmptyState text="暂无数据" />}
            </div>
          </div>
        )}

        {tab === 'member' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="会员总数" value={`${memberSummary?.total ?? 0} 人`} />
              <StatCard label="本期新增" value={`${memberSummary?.new_count ?? 0} 人`} accent="text-emerald-600" />
              <StatCard label="复购率" value={memberSummary?.repeat_rate != null ? `${memberSummary.repeat_rate}%` : '—'} accent="text-brand-600" sub={`复购 ${memberSummary?.repeat_count ?? 0} 人`} />
              <StatCard label="沉睡会员" value={`${memberSummary?.sleep_count ?? 0} 人`} accent="text-amber-600" sub="超30天未到店" />
            </div>
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-gray-700">RFM 会员分层</div>
                <button className="btn-secondary text-xs" onClick={() => setShowWake(true)}>🔔 唤醒沉睡会员</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="核心客" value={`${memberSummary?.rfm?.核心 ?? 0} 人`} accent="text-red-500" sub="高频高消费" />
                <StatCard label="复购客" value={`${memberSummary?.rfm?.复购 ?? 0} 人`} accent="text-brand-600" sub="≥2次到店" />
                <StatCard label="潜力客" value={`${memberSummary?.rfm?.潜力 ?? 0} 人`} accent="text-emerald-600" sub="新客/首客" />
                <StatCard label="沉睡客" value={`${memberSummary?.rfm?.沉睡 ?? 0} 人`} accent="text-amber-600" sub="30-60天未到" />
                <StatCard label="流失客" value={`${memberSummary?.rfm?.流失 ?? 0} 人`} accent="text-gray-500" sub="超60天未到" />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="table w-full">
                <thead><tr><th>会员</th><th>卡号</th><th>分层</th><th>累计充值</th><th>累计消费</th><th>当前余额</th><th>次卡</th><th>到店次数</th><th>最后到店</th></tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="font-medium">{m.name}</td>
                      <td>{m.card_no || '-'}</td>
                      <td><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{m.rfm_tag || '普通'}</span></td>
                      <td className="text-emerald-600">{fmtMoney(m.recharge)}</td>
                      <td className="text-red-500">{fmtMoney(m.consume)}</td>
                      <td>{fmtMoney(m.balance)}</td>
                      <td>{m.times_balance > 0 ? `${m.times_balance}次` : '-'}</td>
                      <td>{m.order_count || 0}</td>
                      <td className="text-gray-500">{m.last_visit ? String(m.last_visit).slice(0, 10) : '从未到店'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {members.length === 0 && <EmptyState text="暂无数据" />}
            </div>
          </div>
        )}

        {tab === 'flow' && (
          <div className="card p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">
              {flow[0]?.day !== undefined ? '到店客流（按天）' : '到店客流（按小时）'}
            </div>
            {!Array.isArray(flow) || flow.length === 0 ? (
              <EmptyState text="暂无数据" />
            ) : flow[0]?.day !== undefined ? (
              <div className="flex items-end gap-1 h-48">
                {flow.map((f) => {
                  const max = Math.max(...flow.map((x) => x.cnt))
                  const height = max > 0 ? (f.cnt / max) * 160 : 0
                  return (
                    <div key={f.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${f.day} - ${f.cnt}单`}>
                      <div className="text-xs text-gray-500 mb-1">{f.cnt}</div>
                      <div className="w-full max-w-[40px] bg-brand-500 rounded-t" style={{ height: `${height}px` }} />
                      <div className="text-[10px] text-gray-400 mt-1">{String(f.day || '').slice(5)}</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex items-end gap-1 h-48">
                {flow.map((f) => {
                  const h = parseInt(f.hour)
                  const max = Math.max(...flow.map((x) => x.cnt))
                  const height = max > 0 ? (f.cnt / max) * 160 : 0
                  return (
                    <div key={f.hour} className="flex-1 flex flex-col items-center justify-end h-full" title={`${h}:00 - ${f.cnt}单 · 客单价¥${f.avg_price ?? 0}`}>
                      <div className="text-xs text-gray-500 mb-1">{f.cnt}</div>
                      <div className="w-full max-w-[40px] bg-brand-500 rounded-t" style={{ height: `${height}px` }} />
                      <div className="text-[10px] text-gray-400 mt-1">{h}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'verify' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="核销总笔数" value={`${verifications.list.length} 笔`} />
              <StatCard label="核销总金额" value={fmtMoney(verifications.list.reduce((s, v) => s + (v.amount || 0), 0))} accent="text-brand-600" />
              <StatCard label="退款笔数" value={`${verifications.refunds.length} 笔`} />
              <StatCard label="退款金额" value={fmtMoney(verifications.refundTotal)} accent="text-red-500" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {verifications.summary.map((s) => (
                <StatCard key={s.method} label={`${s.method}核销`} value={`${s.cnt} 笔 / ${fmtMoney(s.amount)}`} accent="text-emerald-600" />
              ))}
            </div>
            <div className="card overflow-hidden">
              <table className="table w-full">
                <thead><tr><th>时间</th><th>单号</th><th>平台</th><th>券码</th><th>金额</th><th>顾客</th></tr></thead>
                <tbody>
                  {verifications.list.map((v) => (
                    <tr key={v.id}>
                      <td>{v.paid_at}</td>
                      <td>{v.order_no}</td>
                      <td className="font-medium">{v.method}</td>
                      <td className="font-mono text-xs">{v.voucher_code}</td>
                      <td className="font-semibold">{fmtMoney(v.amount)}</td>
                      <td>{v.customer_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {verifications.list.length === 0 && <EmptyState text="该日暂无团购核销记录（结账时选择美团/抖音并录入券码后自动汇总）" />}
            </div>
            {verifications.refunds.length > 0 && (
              <div className="card overflow-hidden">
                <div className="text-sm font-semibold text-gray-700 px-4 pt-3">团购退款明细</div>
                <table className="table w-full">
                  <thead><tr><th>退款时间</th><th>单号</th><th>平台</th><th>券码</th><th>金额</th><th>顾客</th></tr></thead>
                  <tbody>
                    {verifications.refunds.map((r) => (
                      <tr key={r.id}>
                        <td>{r.refund_at}</td>
                        <td>{r.order_no}</td>
                        <td className="font-medium">{r.method}</td>
                        <td className="font-mono text-xs">{r.voucher_code}</td>
                        <td className="font-semibold text-red-500">{fmtMoney(r.amount)}</td>
                        <td>{r.customer_name || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'salary' && (
          <div className="space-y-4">
            <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${payrollLocked ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
              <div><div className="font-semibold text-sm">{payrollLocked ? '该月工资已锁定' : '该月工资尚未锁定'}</div><div className="text-xs mt-1 text-gray-600">锁定后会保存提成规则与计算明细快照，后续改规则不会覆盖已锁定工资。</div></div>
              {!payrollLocked && <AsyncButton className="btn-primary" disabled={loading || !!loadError || loadedKey !== queryKey || !canOperate(user,'settingsManage')} onClick={async () => { if (!window.confirm(`确认锁定 ${startDate.slice(0, 7)} 工资？锁定后会保留当时的计算结果，无法直接覆盖。`)) return; const res = await api.lockPayroll(startDate.slice(0, 7), '报表中心月结锁定'); if (res.ok) { toast('工资已锁定'); await load() } else toast(res.msg || '锁定失败', 'error') }}>锁定本月工资</AsyncButton>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="统计月份" value={salaries.month || startDate.slice(0, 7)} />
              <StatCard label="技师人数" value={`${salaries.list.length} 人`} />
              <StatCard label="工资合计" value={fmtMoney(salaries.list.reduce((s, x) => s + (x.salary || 0), 0))} accent="text-emerald-600" />
              <StatCard label="提成合计" value={fmtMoney(salaries.list.reduce((s, x) => s + (x.commission || 0), 0))} accent="text-brand-600" />
            </div>
            <div className="card overflow-hidden">
              <table className="table w-full">
                <thead><tr><th>排名</th><th>技师</th><th>等级</th><th>底薪</th><th>提成率</th><th>服务金额</th><th>服务钟数</th><th>点钟</th><th>点钟奖励</th><th>加钟提成</th><th>提成合计</th><th>合计工资</th></tr></thead>
                <tbody>
                  {salaries.list.map((t, idx) => (
                    <tr key={t.id}>
                      <td>
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${idx === 0 ? 'bg-amber-100 text-amber-700' : idx === 1 ? 'bg-gray-200 text-gray-700' : idx === 2 ? 'bg-orange-100 text-orange-700' : 'text-gray-500'}`}>
                          {idx + 1}
                        </span>
                      </td>
                      <td className="font-medium">{t.code}号 {t.name}</td>
                      <td>{t.level}</td>
                      <td>{fmtMoney(t.base_salary)}</td>
                      <td>{t.commission_rate}%</td>
                      <td>{fmtMoney(t.service_amount)}</td>
                      <td>{t.served_cnt} 钟</td>
                      <td className="text-sky-600">{t.dianzhong_count || 0}</td>
                      <td className="text-sky-600">{fmtMoney(t.dianzhong_bonus_total)}</td>
                      <td className="text-violet-600">{fmtMoney(t.add_time_commission)}</td>
                      <td className="text-brand-600">{fmtMoney(t.commission)}</td>
                      <td className="font-semibold text-emerald-600">{fmtMoney(t.salary)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {salaries.list.length === 0 && <EmptyState text="该月暂无技师工资数据" />}
            </div>
          </div>
        )}

        {tab === 'room' && (
          <div className="space-y-4">
            {!roomReport ? (
              <EmptyState text="加载中..." />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard label="房间总数" value={`${roomReport.summary?.total_rooms ?? 0} 间`} />
                  <StatCard label="总使用次数" value={`${roomReport.summary?.total_used ?? 0} 次`} />
                  <StatCard label="平均翻台率" value={`${roomReport.summary?.avg_turnover ?? 0} 次`} accent="text-brand-600" sub="总使用次数 ÷ 房间数" />
                </div>
                <div className="card overflow-hidden">
                  <table className="table w-full">
                    <thead><tr><th>房间</th><th>当前状态</th><th>使用次数</th><th>平均时长(分钟)</th><th>营收</th></tr></thead>
                    <tbody>
                      {roomReport.list.map((r: any) => (
                        <tr key={r.id}>
                          <td className="font-medium">{r.room_no}</td>
                          <td>{r.status}</td>
                          <td>{r.used_count || 0}</td>
                          <td>{r.avg_minutes || '-'}</td>
                          <td className="font-semibold">{fmtMoney(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {roomReport.list.length === 0 && <EmptyState text="暂无数据" />}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'cashier' && (
          <div className="space-y-4">
            <div className="card overflow-hidden">
              <table className="table w-full">
                <thead><tr><th>收银员</th><th>订单数</th><th>收款金额</th><th>优惠减免</th><th>支付方式明细</th></tr></thead>
                <tbody>
                  {cashierReport.map((c: any) => (
                    <tr key={c.id}>
                      <td className="font-medium">{c.name || c.username}</td>
                      <td>{c.order_count || 0}</td>
                      <td className="font-semibold text-brand-600">{fmtMoney(c.revenue)}</td>
                      <td className="text-red-500">{fmtMoney(c.discount_total)}</td>
                      <td className="text-gray-500">{(c.payments || []).map((p: any) => `${p.method}${fmtMoney(p.amount)}`).join(' / ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cashierReport.length === 0 && <EmptyState text="暂无数据" />}
            </div>
          </div>
        )}

        {tab === 'analysis' && (
          <div className="space-y-4">
            {!analysis ? (
              <EmptyState text="加载中..." />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="会员总数" value={`${analysis.memberStat?.total || 0} 人`} />
                  <StatCard label="近30天新增" value={`${analysis.memberStat?.new_30d || 0} 人`} accent="text-emerald-600" />
                  <StatCard label="翻台率" value={`${analysis.efficiency?.turnover_rate ?? 0} 次`} sub={`${analysis.efficiency?.closed_orders ?? 0}单 / ${analysis.efficiency?.room_count ?? 0}房`} />
                  <StatCard label="技师人均产值" value={fmtMoney(analysis.efficiency?.avg_revenue_per_tech || 0)} accent="text-brand-600" sub={`近${analysis.days}天 / ${analysis.efficiency?.tech_count ?? 0}技师`} />
                </div>

                <div className="card p-4">
                  <div className="text-sm font-semibold text-gray-700 mb-3">近 {analysis.days} 天营收趋势</div>
                  {analysis.trend.length === 0 ? (
                    <EmptyState text="暂无数据" />
                  ) : (
                    <div className="flex items-end gap-1 h-44">
                      {analysis.trend.map((t: any) => {
                        const max = Math.max(...analysis.trend.map((x: any) => Number(x.revenue)))
                        const h = max > 0 ? (Number(t.revenue) / max) * 160 : 0
                        return (
                          <div key={t.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${t.day} 营收${fmtMoney(t.revenue)} ${t.orders}单`}>
                            <div className="text-[9px] text-gray-400 mb-0.5">{Number(t.revenue) > 0 ? Number(t.revenue).toFixed(0) : ''}</div>
                            <div className={`w-full max-w-[34px] rounded-t ${Number(t.revenue) > 0 ? 'bg-brand-500' : 'bg-gray-100'}`} style={{ height: `${Math.max(h, 2)}px` }} />
                            <div className="text-[9px] text-gray-400 mt-1">{t.day.slice(5)}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="card p-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">🔥 项目 TOP（近30天结账净额）</div>
                    <table className="table w-full">
                      <thead><tr><th>项目</th><th>次数</th><th>金额</th></tr></thead>
                      <tbody>
                        {analysis.itemTop.map((i: any) => (
                          <tr key={i.item_name}><td>{i.item_name}</td><td>{i.cnt}</td><td className="font-semibold">{fmtMoney(i.amount)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {analysis.itemTop.length === 0 && <EmptyState text="暂无" />}
                  </div>
                  <div className="card p-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">👩‍⚕️ 技师 TOP（近30天）</div>
                    <table className="table w-full">
                      <thead><tr><th>技师</th><th>钟数</th><th>金额</th></tr></thead>
                      <tbody>
                        {analysis.techTop.map((t: any) => (
                          <tr key={t.code}><td>{t.code}号 {t.name}</td><td>{t.cnt}</td><td className="font-semibold">{fmtMoney(t.amount)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {analysis.techTop.length === 0 && <EmptyState text="暂无" />}
                  </div>
                  <div className="card p-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">💳 支付占比（近30天）</div>
                    <table className="table w-full">
                      <thead><tr><th>方式</th><th>笔数</th><th>金额</th></tr></thead>
                      <tbody>
                        {analysis.payShare.map((p: any) => (
                          <tr key={p.method}><td className="font-medium">{p.method}</td><td>{p.cnt}</td><td className="font-semibold">{fmtMoney(p.amount)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {analysis.payShare.length === 0 && <EmptyState text="暂无" />}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'growth' && (
          <div className="space-y-4">
            {!growth || !brief ? <EmptyState text="加载中..." /> : <>
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3"><div><div className="text-sm font-semibold text-gray-800">老板经营简报 · {brief.date}</div><div className="text-xs text-gray-400">生成于 {brief.generated_at}</div></div><span className="text-xs text-gray-500">仅给出可核验数据和待办，不自动执行资金操作</span></div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <StatCard label="营业实收" value={fmtMoney(brief.kpis.revenue)} accent="text-brand-600" sub={`${brief.kpis.orders} 笔`} />
                  <StatCard label="客单价" value={fmtMoney(brief.kpis.avg_ticket)} />
                  <StatCard label="候补待处理" value={`${brief.kpis.waiting_customers} 人`} accent="text-amber-600" />
                  <StatCard label="低库存" value={`${brief.kpis.low_stock} 项`} accent="text-red-500" />
                  <StatCard label="待审批" value={`${brief.kpis.pending_approvals} 项`} accent="text-red-500" />
                </div>
                <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {brief.tasks.map((task: any) => <div key={task.code} className={`rounded-lg border px-3 py-2 ${task.severity === 'high' ? 'border-red-200 bg-red-50' : task.severity === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-sky-100 bg-sky-50'}`}><div className="text-sm font-medium text-gray-800">{task.title}</div><div className="text-xs text-gray-500 mt-0.5">建议：{task.action}</div></div>)}
                  {brief.tasks.length === 0 && <div className="text-sm text-emerald-600">当前没有需要立即处理的异常。</div>}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card p-4">
                  <div className="text-sm font-semibold text-gray-700 mb-3">候补转化漏斗</div>
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard label="进入候补" value={`${growth.waitlist.total} 人`} />
                    <StatCard label="获得名额" value={`${growth.waitlist.offered + growth.waitlist.converted} 人`} accent="text-sky-600" />
                    <StatCard label="确认转化" value={`${growth.waitlist.converted} 人`} accent="text-emerald-600" />
                    <StatCard label="整体转化率" value={`${growth.waitlist.conversion_rate}%`} accent="text-brand-600" />
                    <StatCard label="名额接受率" value={`${growth.waitlist.offer_accept_rate}%`} accent="text-brand-600" />
                    <StatCard label="超时失效" value={`${growth.waitlist.expired} 人`} accent="text-amber-600" />
                  </div>
                </div>
                <div className="card p-4">
                  <div className="text-sm font-semibold text-gray-700 mb-3">营销归因汇总</div>
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard label="发券" value={`${growth.marketing.issued_count} 张`} />
                    <StatCard label="核销" value={`${growth.marketing.used_count} 张`} accent="text-emerald-600" />
                    <StatCard label="核销率" value={`${growth.marketing.redemption_rate}%`} accent="text-brand-600" />
                    <StatCard label="优惠成本" value={fmtMoney(growth.marketing.discount_amount)} accent="text-amber-600" />
                    <StatCard label="归因营收" value={fmtMoney(growth.marketing.attributed_revenue)} accent="text-emerald-600" />
                    <StatCard label="营销 ROI" value={growth.marketing.roi == null ? '—' : `${growth.marketing.roi}x`} accent="text-brand-600" />
                  </div>
                </div>
              </div>

              <div className="card overflow-hidden">
                <table className="table w-full"><thead><tr><th>自动营销活动</th><th>渠道</th><th>触发</th><th>发券</th><th>核销</th><th>核销率</th><th>优惠成本</th><th>归因营收</th><th>ROI</th></tr></thead><tbody>
                  {growth.campaigns.map((c: any) => <tr key={c.id}><td className="font-medium">{c.name}<div className="text-xs text-gray-400">{c.trigger_type}</div></td><td>{c.channel}</td><td>{c.triggered_count}</td><td>{c.issued_count}</td><td>{c.used_count}</td><td>{c.redemption_rate}%</td><td>{fmtMoney(c.discount_amount)}</td><td className="font-semibold text-emerald-600">{fmtMoney(c.attributed_revenue)}</td><td>{c.roi == null ? '—' : `${c.roi}x`}</td></tr>)}
                </tbody></table>
                {growth.campaigns.length === 0 && <EmptyState text="该区间暂无自动营销活动记录" />}
              </div>
            </>}
          </div>
        )}
      </div>

      {/* 唤醒沉睡会员弹窗 */}
      <Modal open={showWake} title="唤醒沉睡会员" onClose={() => setShowWake(false)} width="max-w-md" footer={
        <>
          <button className="btn-secondary" onClick={() => setShowWake(false)}>取消</button>
          <button className="btn-primary" onClick={async () => {
            const res = await api.wakeSleepMembers(wakeForm)
            if (res?.count != null) {
              toast(`已给 ${res.count} 位沉睡会员发放唤醒券`)
              setShowWake(false)
            }
          }}>确认发放</button>
        </>
      }>
        <div className="space-y-3">
          <div>
            <label className="label">券名称</label>
            <input className="input" value={wakeForm.name} onChange={(e) => setWakeForm({ ...wakeForm, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">券面值(元)</label>
              <input className="input" type="number" min={1} value={wakeForm.value} onChange={(e) => setWakeForm({ ...wakeForm, value: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">满额门槛(元)</label>
              <input className="input" type="number" min={0} value={wakeForm.min_amount} onChange={(e) => setWakeForm({ ...wakeForm, min_amount: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">有效期(天)</label>
              <input className="input" type="number" min={1} value={wakeForm.expire_days} onChange={(e) => setWakeForm({ ...wakeForm, expire_days: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">沉睡天数阈值</label>
              <input className="input" type="number" min={7} value={wakeForm.threshold_days} onChange={(e) => setWakeForm({ ...wakeForm, threshold_days: Number(e.target.value) })} />
            </div>
          </div>
          <div className="text-xs text-gray-500">将给「沉睡+流失」会员（超阈值天数未到店或从未消费）每人发一张券，结账时自动抵扣。</div>
        </div>
      </Modal>
    </div>
  )
}
