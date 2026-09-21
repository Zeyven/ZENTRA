import {DialogLayer} from '../components/ui'
import { useCallback, useState,useRef } from 'react'
import { api } from '../api'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { Badge, EmptyState,AsyncButton,Modal } from '../components/ui'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import {canOperate} from '../utils/permissions'
import {assertActionResult} from '../utils/action-result'
import {clockCount,clockStatus} from '../utils/clock-room'
import RoomWarnings from '../components/RoomWarnings'
import TechnicianAnnouncer from '../components/TechnicianAnnouncer'

interface TechRow {
  id: number
  name: string
  code: string
  level: string
  status: string
  queue_position: number
  assigned_today: number
  served_today: number
  reserved_today?: number
  serving?: { room: string; item: string; state?: string }
}

// 语音播报：Web Speech API（Chrome/Edge 可用，免硬件）
function speak(text: string): Promise<void> {
 return new Promise((resolve,reject)=>{
  if(!('speechSynthesis' in window)){reject(Error('当前浏览器不支持语音播报'));return}
  const utter=new SpeechSynthesisUtterance(text);utter.lang='zh-CN';utter.rate=0.9;utter.onend=()=>resolve();utter.onerror=event=>reject(Error('语音播报未完成：'+event.error));window.speechSynthesis.cancel();window.speechSynthesis.speak(utter)
 })
}

export default function ClockRoom(): JSX.Element {
  const user = useAuth((s) => s.user)!
  const storeId=useAuth(s=>s.currentStoreId)
  const [announcerOpen,setAnnouncerOpen]=useState(false)
  const [rows, setRows] = useState<TechRow[]>([])
  const [callTarget, setCallTarget] = useState<TechRow | null>(null)
  const [callRoom, setCallRoom] = useState('')
  const [loadError,setLoadError]=useState(''),[queueOrder,setQueueOrder]=useState<{rows:any[];version:string}|null>(null),[orderError,setOrderError]=useState('')
  const [orderReason,setOrderReason]=useState(''),[history,setHistory]=useState<any[]|null>(null)
  const sequence=useRef(0),savingOrder=useRef(false)

  const load = useCallback(async () => {
    const current=++sequence.current
    try {
      const [queue, snap] = await Promise.all([api.technicianQueue(), api.getSnapshot()])
      if(current!==sequence.current)return
      setLoadError('')
      // 构建 技师 → 当前房间/项目 映射（来自 open 订单）
      const servingMap: Record<number, { room: string; item: string; state?: string }> = {}
      for (const r of snap.resources || []) {
        for (const it of r.items || []) {
          if (it.technician_id && it.type === 'SERVICE' && !it.is_refund && it.status === 'IN_PROGRESS') {
            servingMap[it.technician_id] = { room: r.name || r.code, item: it.service_name || it.item_name, state:it.clock_state }
          }
        }
      }
      setRows(
        (queue || []).map((t: any) => ({
          id: t.id,
          name: t.name,
          code: t.code,
          level: t.level,
          status: t.status,
          queue_position: clockCount(t.queue_position),
          assigned_today:clockCount(t.assigned_today),
          served_today: clockCount(t.served_today),
          reserved_today: clockCount(t.reserved_today),
          serving: servingMap[t.id]
        }))
      )
    } catch(error) {
      if(current===sequence.current)setLoadError(error instanceof Error?error.message:'排钟加载失败')
    }
  }, [])


  useAutoRefresh(load)

  const waiting = rows.filter((r) => r.status === 'on')
  const busy = rows.filter((r) => r.status === 'serving')
  const onDuty = rows.filter(r => ['on','rest','serving'].includes(r.status))
  const unavailable = rows.filter(r => !['on','serving'].includes(r.status))
  const totalClocks = rows.reduce((s, r) => s + r.served_today, 0)

  const doCall = async (): Promise<void> => {
    if (loadError || !rows.some(t=>t.id===callTarget?.id&&t.status==='on')) { toast('技师状态已变化或未确认，请刷新后重新选择', 'error'); return }
    if (!callTarget || !callRoom.trim()) {
      toast('请输入房间号', 'error')
      return
    }
    const msg = `${callTarget.code}号技师${callTarget.name}，请到${callRoom.trim()}房间上钟`
    await speak(msg)
    toast(`播报完成：${msg}`)
    setCallTarget(null)
    setCallRoom('')
  }

  const TechCard = (props: { t: TechRow; showCall?: boolean }): JSX.Element => {
    const { t, showCall } = props
    return (
      <div key={t.id} className="card p-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center font-bold">{t.code}</div>
            <div>
              <div className="font-semibold text-gray-800">{t.name}</div>
              <div className="text-xs text-gray-400">{t.level}</div>
            </div>
          </div>
          <Badge text={clockStatus(t.status,t.serving?.state).label} className={clockStatus(t.status,t.serving?.state).className} />
        </div>
        {t.serving && <div className="text-xs text-gray-600 mb-2">📍 {t.serving.room} · {t.serving.item}</div>}
        <div className="text-xs text-gray-400 mb-3">
          今日已开钟 {t.assigned_today} 单 · 已完成 {t.served_today} 钟
          {(t.reserved_today || 0) > 0 && <span className="text-violet-500 ml-1">📅 预约 {t.reserved_today} 场</span>}
        </div>
        <div className="flex gap-1.5">
          {showCall && !loadError && (
            <button className="btn-primary flex-1 text-xs py-1.5" onClick={() => { setCallTarget(t); setCallRoom('') }}>
              🔊 叫钟播报
            </button>
          )}
          <AsyncButton className="btn-secondary flex-1 text-xs py-1.5" onClick={() => speak(`${t.code}号技师${t.name}，请到前台报到`)}>
            🔔 广播
          </AsyncButton>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <header className="min-h-14 py-3 bg-white border-b border-gray-200 flex flex-wrap gap-3 items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-800">钟房 / 排钟</h2>
          <span className="text-xs text-gray-400">语音播报需浏览器授权，请保持本页面打开</span>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {canOperate(user,'settingsManage')&&<button className="btn-secondary" onClick={()=>setAnnouncerOpen(true)}>技师房播报器</button>}
          <button className="btn-primary" onClick={() => { window.location.search = '?room-terminal=1' }}>房间报钟器</button>
          {canOperate(user,'technicianManage')&&<AsyncButton className="btn-secondary" onClick={async()=>{setQueueOrder(await api.technicianQueueOrder());setOrderError('');setOrderReason('')}}>同钟数排钟顺序</AsyncButton>}
          {canOperate(user,'technicianManage')&&<AsyncButton className="btn-secondary" onClick={async()=>setHistory(await api.technicianQueueHistory())}>排钟调整记录</AsyncButton>}
          <AsyncButton className="btn-secondary" onClick={load}>刷新</AsyncButton>
        </div>
      </header>
      <RoomWarnings />
      <Modal open={announcerOpen} title="技师房播报器" onClose={()=>setAnnouncerOpen(false)} width="max-w-3xl"><TechnicianAnnouncer key={storeId}/></Modal>
      {loadError&&<p role="alert" className="px-5 py-3 text-red-700">{loadError}；当前排钟状态未确认，请刷新。</p>}

      <p className="px-5 pt-3 text-xs text-gray-500">休息技师不计入等待；列表展示今日已完成钟数，自动派钟还会检查在岗状态、项目技能及已开钟服务单数。叫钟播报不会自动派工。</p>
      <div className="grid grid-cols-4 gap-3 px-5 pt-4">
        <div className="card p-3 text-center"><div className="text-xs text-gray-500">在岗技师</div><div className="text-xl font-bold text-gray-800">{onDuty.length}</div></div>
        <div className="card p-3 text-center"><div className="text-xs text-gray-500">等待排钟</div><div className="text-xl font-bold text-amber-600">{waiting.length}</div></div>
        <div className="card p-3 text-center"><div className="text-xs text-gray-500">已派服务</div><div className="text-xl font-bold text-red-500">{busy.length}</div></div>
        <div className="card p-3 text-center"><div className="text-xs text-gray-500">今日已完成钟数</div><div className="text-xl font-bold text-brand-600">{totalClocks}</div></div>
      </div>

      <div className="flex-1 overflow-auto min-h-0 px-5 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">⏳ 等待技师（{waiting.length}）</div>
          <div className="grid grid-cols-2 gap-2">
            {waiting.map((t) => <TechCard key={t.id} t={t} showCall />)}
            {waiting.length === 0 && <EmptyState text="无等待技师" />}
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">⏱ 已派服务（{busy.length}）</div>
          <div className="grid grid-cols-2 gap-2">
            {busy.map((t) => <TechCard key={t.id} t={t} />)}
            {busy.length === 0 && <EmptyState text="无已派服务技师" />}
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">💤 休息 / 下班 / 待确认（{unavailable.length}）</div>
          <div className="grid grid-cols-2 gap-2">
            {unavailable.map((t) => <TechCard key={t.id} t={t} />)}
            {unavailable.length === 0 && <EmptyState text="无休息或下班技师" />}
          </div>
        </div>
      </div>

      <Modal open={history!==null} title="排钟调整记录" onClose={()=>setHistory(null)}><p className="text-sm mb-3">显示当前门店最近30次调整。自动派钟按可上钟、项目技能、今日已开钟服务单数、人工顺序依次筛选；正在处理的并发派工也会占用技师。</p>{history?.length===0&&<p>暂无调整记录</p>}{history?.map(row=><div className="border-b py-3" key={row.id}><p>{new Date(row.created_at).toLocaleString()} · {row.operator_name||'授权操作员'}</p><p>{row.detail.reason||'历史记录未填写原因'}</p><p className="text-xs text-gray-500">技师ID顺序：{row.detail.before?.join(' → ')||'未记录'} → 调整后：{row.detail.ids?.join(' → ')}</p></div>)}</Modal>
      {/* 叫钟弹窗 */}
      {callTarget && (
        <DialogLayer title="呼叫技师" onClose={() => setCallTarget(null)}>
          <div className="bg-white rounded-lg shadow-2xl w-96 p-6" onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-lg font-bold mb-4">叫钟：{callTarget.code}号 {callTarget.name}</div>
            <label className="label">房间号（播报用）</label>
            <input className="input" value={callRoom} onChange={(e) => setCallRoom(e.target.value)} placeholder="如 601" autoFocus />
            <div className="flex gap-2 mt-4">
              <button className="btn-secondary flex-1" onClick={() => setCallTarget(null)}>取消</button>
              <AsyncButton className="btn-primary flex-1" onClick={doCall}>🔊 播报叫钟</AsyncButton>
            </div>
          </div>
        </DialogLayer>
      )}
      <Modal open={!!queueOrder} title="同钟数排钟顺序" onClose={()=>{if(!savingOrder.current)setQueueOrder(null)}} footer={<AsyncButton className="btn-primary" onClick={async()=>{if(!queueOrder||savingOrder.current)return;if(orderReason.trim().length<2){setOrderError('请填写至少两个字的调整原因');return;}savingOrder.current=true;try{assertActionResult(await api.saveTechnicianQueueOrder(queueOrder.rows.map(r=>r.id),queueOrder.version,orderReason.trim()));setQueueOrder(null);await load()}catch(e){setOrderError(e instanceof Error?e.message:'排序保存失败')}finally{savingOrder.current=false}}}>保存排钟顺序</AsyncButton>}>
       <p className="text-sm text-gray-500 mb-3">自动派钟先检查在岗、技能和已开钟服务单数，钟数相同时按此顺序。此处包含所有启用技师。</p>
       {queueOrder?.rows.map((row,index)=><div key={row.id} className="flex gap-3 items-center p-2 border-b"><span className="flex-1">{index+1}. {row.code} · {row.name}</span>{([-1,1] as const).map(direction=><button key={direction} aria-label={(direction<0?'上移':'下移')+row.name} className="btn-secondary" disabled={index+direction<0||index+direction>=queueOrder.rows.length} onClick={()=>{if(savingOrder.current)return;const next=[...queueOrder.rows];[next[index],next[index+direction]]=[next[index+direction],next[index]];setQueueOrder({...queueOrder,rows:next})}}>{direction<0?'↑':'↓'}</button>)}</div>)}
       <label className="block mt-3">调整原因<textarea aria-label="排钟调整原因" className="input w-full" maxLength={300} value={orderReason} onChange={e=>setOrderReason(e.target.value)}/></label>
       {orderError&&<p role="alert" className="text-red-700 mt-3">{orderError}</p>}
      </Modal>
    </div>
  )
}
