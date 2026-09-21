import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { LogPage, LogSource, MaintenanceLog, MaintenanceSummary } from '../types/maintenance'
import { Modal } from './ui'

const labels: Record<LogSource, string> = { request: '接口请求', system: '系统运行', operation: '业务操作', audit: '敏感审计', clock: '报钟事件', realtime: '同步事件' }
const initial = { source: 'request', q: '', store_id: '', user_id: '', start: '', end: '', level: '', status_code: '', min_duration: '' }
const message = (error: unknown) => error instanceof Error ? error.message : '维护数据读取失败，请重试'

export default function MaintenanceLogs({ stores }: { stores: { id: number; name: string }[] }): JSX.Element {
  const [form, setForm] = useState(initial)
  const [query, setQuery] = useState<Record<string, string>>(initial)
  const [cursor, setCursor] = useState<string[]>([''])
  const [page, setPage] = useState<LogPage | null>(null)
  const [summary, setSummary] = useState<MaintenanceSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState('')
  const [auto, setAuto] = useState(false)
  const [detail, setDetail] = useState<MaintenanceLog | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++ } }, [])
  const before = cursor.at(-1) || ''
  const load = useCallback(async () => {
    const id = ++generation.current
    inFlight.current = true; setBusy(true); setError('')
    try {
      const [logs, stats] = await Promise.all([api.maintenanceLogs({ ...query, before_id: before }), api.maintenanceSummary()])
      if (id !== generation.current) return
      setPage(logs); setSummary(stats); setUpdated(new Date().toLocaleTimeString())
    } catch (e) { if (id === generation.current) { setError(message(e)); setPage(null) } }
    finally { if (id === generation.current) { inFlight.current = false; setBusy(false) } }
  }, [query, before])
  useEffect(() => { void load(); return () => { generation.current++ } }, [load])
  useEffect(() => {
    if (!auto || before) return
    const timer = window.setInterval(() => { if (!document.hidden && !inFlight.current && !detail) void load() }, 10000)
    return () => clearInterval(timer)
  }, [auto, before, load, detail])
  const apply = (next = form) => { setPage(null); setQuery({ ...next }); setCursor(['']); setNotice('') }
  const field = (key: keyof typeof form, value: string) => setForm(prev => ({ ...prev, [key]: value }))
  const openDetail = async (row: MaintenanceLog) => {
    setDetailBusy(true); setError('')
    try { const result = await api.maintenanceDetail(row.source, row.id); if (mounted.current) setDetail(result) }
    catch (e) { if (mounted.current) setError(message(e)) }
    finally { if (mounted.current) setDetailBusy(false) }
  }
  const exportLogs = async () => {
    setExporting(true); setError('')
    try {
      const data = await api.maintenanceExport(query)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `ZA-Thera-maintenance-${query.source}-${Date.now()}.json`
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      if (mounted.current) setNotice(`已导出 ${data.rows.length} 条脱敏日志${data.has_more ? '，结果超过500条，请缩小日期范围后分批导出' : ''}。导出操作已记录。`)
    } catch (e) { if (mounted.current) setError(message(e)) }
    finally { if (mounted.current) setExporting(false) }
  }
  const runtime = ['request','system'].includes(form.source)
  return <section className="space-y-4" aria-label="维护日志中心">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-lg font-semibold">维护日志中心</h3><p className="text-sm text-gray-500 mt-1">定位请求失败、业务变更与同步事件。仅商家老板及已获授权的平台支持会话可访问当前门店。</p></div>
      <div className="flex items-center flex-wrap gap-3 text-sm">
        <label><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> 每10秒刷新首页</label>
        <button className="btn" disabled={busy} onClick={() => void load()}>刷新日志</button>
        <button className="btn" disabled={exporting || busy || !page} onClick={() => void exportLogs()}>{exporting ? '导出中…' : '导出筛选结果'}</button>
      </div>
    </div>
    {summary && <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Object.entries({ '24小时请求': summary.recent.requests, '服务端错误（5xx）': summary.recent.errors, '拒绝/失败（4xx）': summary.recent.rejected, '慢请求（≥1秒）': summary.recent.slow, '平均耗时（ms）': summary.recent.average_ms }).map(([label, value]) => <div className="card p-3" key={label}><p className="text-xs text-gray-500">{label}</p><p className="text-2xl font-semibold mt-1">{value}</p></div>)}
      </div>
      <div className="card p-3 text-sm flex flex-wrap gap-x-6 gap-y-2">
        <span>服务端版本 {summary.version}</span><span>运行 {Math.floor(summary.uptime_seconds / 60)} 分钟</span><span>进程内存 {summary.memory_mb} MB</span>
        <span>数据库读取：{summary.database_readable ? '正常' : '异常'}</span><span>日志时区：{summary.timezone}</span><span>最近刷新：{updated}</span>
        <span>最近日志写入：{summary.collector.last_write_at ? new Date(summary.collector.last_write_at).toLocaleString() : '暂无'}</span>
      </div>
      {summary.collector.failed_writes > 0 && <div role="alert" className="p-3 rounded-lg bg-red-50 text-red-700">日志写入或清理失败 {summary.collector.failed_writes} 次；本进程最近失败：{summary.collector.last_failure_at}。记录可能缺失，请检查服务器磁盘与数据库权限。</div>}
    </>}
    <form onSubmit={e => { e.preventDefault(); apply() }} className="card p-4 grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
      <label>日志来源<select aria-label="日志来源" className="input w-full mt-1" value={form.source} onChange={e => setForm(prev => ({ ...prev, source: e.target.value, level: '', status_code: '', min_duration: '', user_id: '' }))}>{Object.entries(labels).map(([key, value]) => <option value={key} key={key}>{value}</option>)}</select></label>
      <label>所属门店<select aria-label="所属门店" className="input w-full mt-1" value={form.store_id} onChange={e => field('store_id', e.target.value)}><option value="">当前选择的门店</option>{stores.map(s => <option value={s.id} key={s.id}>{s.name}（#{s.id}）</option>)}</select></label>
      <label>操作人内部ID<input className="input w-full mt-1" type="number" min="1" value={form.user_id} disabled={form.source === 'realtime'} onChange={e => field('user_id', e.target.value)} /></label>
      <label>级别<select aria-label="级别" className="input w-full mt-1" disabled={!runtime} value={form.level} onChange={e => field('level', e.target.value)}><option value="">全部级别</option><option value="info">正常 info</option><option value="warn">警告 warn</option><option value="error">错误 error</option></select></label>
      <label>开始日期<input className="input w-full mt-1" type="date" value={form.start} onChange={e => field('start', e.target.value)} /></label>
      <label>结束日期<input className="input w-full mt-1" type="date" value={form.end} onChange={e => field('end', e.target.value)} /></label>
      <label>HTTP状态码<input className="input w-full mt-1" type="number" min="100" max="599" value={form.status_code} disabled={form.source !== 'request'} onChange={e => field('status_code', e.target.value)} /></label>
      <label>最小耗时（ms）<input className="input w-full mt-1" type="number" min="0" max="3600000" value={form.min_duration} disabled={form.source !== 'request'} onChange={e => field('min_duration', e.target.value)} /></label>
      <label className="col-span-2">事件 / 路由 / 请求ID<input className="input w-full mt-1" maxLength={120} value={form.q} onChange={e => field('q', e.target.value)} placeholder="例如：结账、sessions、请求ID" /></label>
      <div className="col-span-2 flex items-end gap-2"><button className="btn btn-primary" type="submit" disabled={busy}>查询日志</button><button className="btn" type="button" onClick={() => { setForm(initial); apply(initial) }}>重置筛选</button></div>
    </form>
    {error && <div role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg">{error}</div>}
    {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <div className="card overflow-x-auto" aria-busy={busy}>
      <table className="w-full text-sm"><thead><tr>{['时间 / 编号','来源 / 级别','门店 / 操作人','事件 / 请求路由','状态 / 耗时','详情'].map(h => <th key={h} className="p-3 text-left whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{page?.rows.map(row => <tr key={`${row.source}-${row.id}`} className="border-t border-gray-100">
          <td className="p-3 whitespace-nowrap">{row.created_at}<div className="text-xs text-gray-400">#{row.id}</div></td>
          <td className="p-3 whitespace-nowrap">{labels[row.source]}<div className={row.level === 'error' ? 'text-red-600' : row.level === 'warn' ? 'text-amber-700' : 'text-gray-400'}>{row.level}</div></td>
          <td className="p-3 whitespace-nowrap">{row.store_id ? `${stores.find(s => s.id === row.store_id)?.name || '门店'} #${row.store_id}` : '当前商家系统事件'}<div className="text-xs text-gray-500">{row.user_id ? `${row.operator_name || '已删除账号'} #${row.user_id}` : '系统 / 未认证'}</div></td>
          <td className="p-3 max-w-sm break-all">{row.route ? `${row.method} ${row.route}` : row.action}<div className="text-xs text-gray-400 font-mono">{row.request_id}</div></td>
          <td className="p-3 whitespace-nowrap">{row.status_code ?? '—'} / {row.duration_ms !== null ? `${row.duration_ms}ms` : '—'}</td>
          <td className="p-3"><button className="btn whitespace-nowrap" disabled={detailBusy} onClick={() => void openDetail(row)}>查看详情</button></td>
        </tr>)}</tbody></table>
      {!page?.rows.length && <p role="status" className="p-10 text-center text-gray-500">{busy ? '正在读取日志…' : error ? '日志读取失败' : '没有符合条件的日志'}</p>}
    </div>
    <div className="flex flex-wrap justify-between gap-2 text-sm text-gray-500"><span>{page ? `${labels[page.source]} · 本页 ${page.rows.length} 条` : ''} · 第 {cursor.length} 页{before && auto ? '（翻页期间自动刷新暂停）' : ''}</span><div className="flex gap-2"><button className="btn" disabled={busy || cursor.length === 1} onClick={() => setCursor(prev => prev.slice(0,-1))}>上一页</button><button className="btn" disabled={busy || !page?.has_more} onClick={() => setCursor(prev => [...prev, String(page!.next_cursor)])}>下一页</button></div></div>
    <details className="card p-4 text-sm text-gray-600"><summary className="cursor-pointer font-medium">采集范围、保留策略与隐私说明</summary>
      <p className="mt-3">已认证业务请求从新版服务启动后采集，系统分类记录其中的服务端失败；每个商家的诊断记录最多保留 {summary?.retention.days ?? 30} 天 / {summary?.retention.max_rows.toLocaleString() ?? '10,000'} 条，写入时清理过期及超量记录；后台每分钟巡检最多 20 家商家，也覆盖停用商家。业务审计和同步记录不受诊断清理影响。</p>
      <p className="mt-2">不采集密码、令牌、请求正文或查询参数；审计快照采用字段白名单。页面只查当前连接的服务端，未接入系统日志文件、Nginx、NAS复制日志、浏览器崩溃和实体设备协议日志。数据库“读取正常”不代表备份/容灾已经验收。</p>
      <p className="mt-2">维护查询、会话轮询、实时游标、健康检查和静态资源不重复记录。登录失败以及尚未通过商家授权的请求不进入门店诊断记录。请求ID用于关联本次接口与异常，旧业务日志没有请求ID时按时间、门店、操作人和业务编号排查。操作人姓名为账号当前名称，内部ID用于长期追踪；金额仅为业务记录。24小时指标仅统计仍保留的请求记录。</p>
      <ul className="mt-3 space-y-1">{summary?.coverage.map(item => <li key={item.source}>{item.label}：{item.latest ? `最新 #${item.latest.id} · ${item.latest.created_at}` : '暂无记录'}</li>)}</ul>
    </details>
    <Modal open={!!detail} title="维护日志详情" onClose={() => setDetail(null)} width="max-w-3xl">
      {detail && <><p className="text-sm text-gray-500 mb-3">{labels[detail.source]} #{detail.id} · 可复制请求ID查询关联异常。自由文本和隐私字段已限制展示。</p><pre className="text-xs bg-gray-50 p-4 rounded-lg whitespace-pre-wrap break-all max-h-[60vh] overflow-auto select-text">{JSON.stringify(detail, null, 2)}</pre></>}
    </Modal>
  </section>
}
