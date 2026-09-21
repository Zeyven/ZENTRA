import {BRAND_NAME} from '../../../shared/brand'
import {canOperate} from '../utils/permissions'
import {useAuth} from '../store/auth'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { toast } from '../store/toast'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { Modal } from '../components/ui'
import RoomWarnings from '../components/RoomWarnings'
import {parseMoneyInput} from '../utils/format'

type Clock = {
  id: number; order_id: number; room_id: number; room_no: string; order_version: number; technician_code: string; technician_name: string
  service_name: string; state: string; expected_end_at: string | null; remaining_seconds: number | null
  reminders: { id: number; kind: string }[]; requests: { id: number; minutes: number; reason: string }[]
}
const labels: Record<string, string> = { WAITING: '待派技师', ASSIGNED: '待到房', READY: '已到房', IN_SERVICE: '服务中', ENDING_SOON: '即将到钟', OVERTIME: '已到钟 / 超时', PAUSED: '已暂停', COMPLETED: '已下钟', CANCELLED: '已取消' }
const speech: Record<string, string> = { before_10: '还有十分钟到钟', before_5: '还有五分钟到钟', due: '已到钟，请确认加钟或下钟', overtime_5: '已超时五分钟，请联系前台' }

export default function ClockTerminal({ orderId }: { orderId?: number } = {}): JSX.Element {
  const user=useAuth(s=>s.user)!
  const [data, setData] = useState<{ clocks: Clock[]; rooms:{id:number;room_no:string}[]; can_manage: boolean; confirmation_mode: boolean } | null>(null)
  const [room, setRoom] = useState('')
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const [voice, setVoice] = useState(false)
  const [busy, setBusy] = useState(false)
  const acting=useRef(false)
  const [form, setForm] = useState<{ clock: Clock; action: string; event?: number } | null>(null)
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [amount, setAmount] = useState('')
  const time = useRef({ server: 0, mono: 0 })
  const spoken = useRef(new Set<number>())
  const pending = useRef(new Map<string, Record<string, unknown>>())
  const load = useCallback(async () => {
    try {
      const next = await api.getClocks()
      time.current = { server: next.server_now, mono: performance.now() }
      setData(next); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : '报钟服务连接失败') }
  }, [])
  useAutoRefresh(load, 5000,{pollWhenConnected:true})
  useEffect(() => { const timer = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(timer) }, [])
  const stale = Boolean(error) || !time.current.server || performance.now() - time.current.mono > 15000
  const clocks = data?.clocks.filter(c => (!orderId || c.order_id === orderId) && (!room || String(c.room_id) === room)) || []
  const rooms = (data?.rooms||[]).map(r=>[String(r.id),r.room_no])
  useEffect(() => {
    if (!voice || stale || !room || !('speechSynthesis' in window)) return
    for (const clock of clocks) for (const reminder of clock.reminders) {
      if (spoken.current.has(reminder.id) || ['COMPLETED', 'CANCELLED', 'PAUSED'].includes(clock.state)) continue
      spoken.current.add(reminder.id)
      const message = new SpeechSynthesisUtterance(`${clock.technician_code}号技师，${clock.room_no}房服务${speech[reminder.kind] || '时间提醒'}`)
      message.lang = 'zh-CN'; window.speechSynthesis.speak(message)
    }
  }, [data, voice, room, stale])
  useEffect(() => () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel() }, [])

  const act = async (clock: Clock, action: string, extra: Record<string, unknown> = {}): Promise<void> => {
    if (stale || busy || acting.current) return
    acting.current=true
    const signature = JSON.stringify([clock.id, action, extra])
    const payload = pending.current.get(signature) || { ...extra, expected_version: clock.order_version, request_key: crypto.randomUUID() }
    pending.current.set(signature, payload)
    setBusy(true)
    try {
      const result = await api.clockAction(clock.id, action, payload)
      if (result.ok === false) { if(result.code!=='RESULT_UNKNOWN')pending.current.delete(signature); throw new Error(result.msg || result.message || '报钟失败') }
      pending.current.delete(signature); setForm(null); toast('报钟已确认'); await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : '报钟未确认，请刷新重试', 'error')
      // A lost response keeps its request key so retry cannot double-start or double-charge.
      await load()
    } finally { acting.current=false;setBusy(false) }
  }
  const openForm = (clock: Clock, action: string, request?: { id: number; minutes: number }): void => {
    setForm({ clock, action, event: request?.id }); setReason(''); setAmount(''); setMinutes(String(request?.minutes || 30))
  }
  // 空输入不再发送 0/空值：金额为空则从请求体省略；非空必须为有效正数，避免静默提交 ¥0 或 null。
  const submit = (): void => {
    if (!form) return
    const extra: Record<string, unknown> = { reason }
    if (['add-time', 'request-add-time'].includes(form.action)) {
      if (minutes.trim() !== '') {
        const mins = parseMoneyInput(minutes)
        if (!Number.isInteger(mins) || mins < 1) { toast('加钟分钟数必须为大于 0 的整数', 'error'); return }
        extra.minutes = mins
      }
    }
    if (form.action === 'add-time') {
      if (amount.trim() !== '') {
        const value = parseMoneyInput(amount)
        if (!Number.isFinite(value) || value <= 0) { toast('加钟金额必须大于 0', 'error'); return }
        extra.amount = value
      }
      extra.request_event_id = form.event
    }
    void act(form.clock, form.action, extra)
  }
  const remaining = (clock: Clock): string => {
    if (!clock.expected_end_at) return '等待上钟'
    const seconds = clock.state === 'PAUSED' ? clock.remaining_seconds || 0 : Math.ceil((Date.parse(clock.expected_end_at) - time.current.server - (performance.now() - time.current.mono)) / 1000)
    return `${seconds < 0 ? '超时 ' : '剩余 '}${Math.floor(Math.abs(seconds) / 60)}:${String(Math.abs(seconds) % 60).padStart(2, '0')}`
  }
  return <div className={`${orderId ? '' : 'min-h-screen'} bg-gray-50 text-gray-800 p-4`} data-tick={tick}>
    <header className="flex flex-wrap items-center justify-between gap-3 bg-white border rounded-lg p-4">
      <div><h1 className="text-xl font-bold">{BRAND_NAME} 房间报钟器</h1><p className="text-xs text-gray-500">员工登录 · 服务端统一计时 · 本终端不收款</p></div>
      {!orderId && <div className="flex flex-wrap gap-2 items-center"><select className="input w-40" aria-label="报钟房间" value={room} onChange={e => setRoom(e.target.value)}><option value="">全部授权钟单</option>{rooms.map(([id, name]) => <option key={id} value={id}>{name} 房</option>)}</select>
        <button className="btn-secondary" onClick={() => { if (!room) { toast('请先选择房间', 'error'); return }; if (!('speechSynthesis' in window)) { toast('此浏览器不支持语音', 'error'); return }; setVoice(!voice) }}>{voice ? '关闭催钟语音' : '开启催钟语音'}</button>
        <button className="btn-secondary" onClick={() => { window.location.search = '' }}>返回工作台</button></div>}
    </header>
    {!orderId && <RoomWarnings roomId={room} />}
    <p className={`my-3 text-sm ${stale ? 'text-red-600' : 'text-emerald-700'}`}>{stale ? `连接未确认，禁止报钟写入。${error}` : '在线同步中；计时由服务器记录，刷新页面不会重置。'}</p>
    {!orderId && data?.can_manage && <label className="flex gap-2 text-sm mb-4"><input type="checkbox" checked={data.confirmation_mode} disabled={(stale || busy)||!canOperate(user,'settingsManage')} onChange={async e => { setBusy(true); try { await api.clockSettings(e.target.checked); await load() } catch { toast('模式保存失败', 'error') } finally { setBusy(false) } }} />新派钟须到房确认后开始计时（不改变已经开始的服务）</label>}
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{clocks.map(clock => <section key={clock.id} className="card p-5" data-clock-id={clock.id}>
      <div className="flex justify-between"><h2 className="text-lg font-bold">{clock.room_no || '无房间'} · {clock.technician_code}号</h2><span className="text-sm">{labels[clock.state]}</span></div>
      <p className="my-2">{clock.technician_name} · {clock.service_name}</p>
      <p className="text-3xl font-bold text-brand-700 my-5">{clock.state === 'COMPLETED' ? '服务已结束' : remaining(clock)}</p>
      <div className="flex flex-wrap gap-2">
        {clock.state === 'ASSIGNED' && <button className="btn-secondary" disabled={(stale || busy)||!canOperate(user,'clockOperate')} onClick={() => void act(clock, 'ready')}>确认到房</button>}
        {['ASSIGNED', 'READY'].includes(clock.state) && <button className="btn-primary" disabled={(stale || busy)||!canOperate(user,'clockOperate')} onClick={() => void act(clock, 'start')}>确认上钟</button>}
        {clock.state === 'PAUSED' && <button className="btn-primary" disabled={(stale || busy)||!canOperate(user,'clockOperate')} onClick={() => void act(clock, 'resume')}>恢复计时</button>}
        {['IN_SERVICE', 'ENDING_SOON', 'OVERTIME'].includes(clock.state) && <button className="btn-secondary" disabled={(stale || busy)||!canOperate(user,'clockOperate')} onClick={() => openForm(clock, 'pause')}>暂停</button>}
        {['IN_SERVICE', 'ENDING_SOON', 'OVERTIME', 'PAUSED'].includes(clock.state) && <><button className="btn-secondary" disabled={(stale || busy)||!canOperate(user,'clockOperate')} onClick={() => openForm(clock, 'request-add-time')}>申请加钟</button><button className="btn-primary" disabled={(stale || busy)||!canOperate(user,'finishService')} onClick={() => openForm(clock, 'finish')}>确认下钟</button></>}
      </div>
      {clock.requests.map(request => <div className="mt-4 border-t pt-3 text-sm" key={request.id}>待确认加钟 {request.minutes} 分钟 {data?.can_manage && <button className="btn-secondary ml-2" disabled={(stale || busy)||!canOperate(user,'addTime')} onClick={() => openForm(clock, 'add-time', request)}>核价并确认</button>}</div>)}
    </section>)}</div>
    {!clocks.length && <p className="p-12 text-center text-gray-500">暂无授权钟单。技师账号仅显示本人工单。</p>}
    <p className="mt-6 text-xs text-gray-500">催钟需要页面保持前台运行且已开启语音；浏览器休眠、退出或离线时不能保证播报。实体刷卡器、推送和客控尚未接入。</p>
    <Modal open={Boolean(form)} title={form?.action === 'add-time' ? '确认加钟金额' : form?.action === 'request-add-time' ? '申请加钟' : '报钟确认'} onClose={() => { if (!busy) setForm(null) }} footer={<button className="btn-primary" disabled={(busy || stale)||!canOperate(user,'addTime')} onClick={submit}>确认提交</button>}>
      {['add-time', 'request-add-time'].includes(form?.action || '') && <label className="label">加钟分钟<input className="input" type="number" min="1" max="240" value={minutes} disabled={form?.action === 'add-time'} onChange={e => setMinutes(e.target.value)} /></label>}
      {form?.action === 'add-time' && <label className="label">已确认加钟金额（元）<input className="input" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>}
      <label className="label">原因 / 备注（暂停或提前下钟必填）<input className="input" value={reason} onChange={e => setReason(e.target.value)} /></label>
    </Modal>
  </div>
}
