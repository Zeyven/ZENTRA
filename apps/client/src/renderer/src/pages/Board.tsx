import OperatingAlerts from '../components/OperatingAlerts'
import {serviceStatus} from '../utils/room-operations'
import {canOperate} from '../utils/permissions'
import {DialogLayer} from '../components/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { Order, Room, Technician } from '../types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { useRealtime } from '../store/realtime'
import { setPrebookTech } from '../store/flow'
import { fmtMoney, fmtDuration, elapsedMinutes, TECH_STATUS, TECH_LEVELS, sortTechnicians, today } from '../utils/format'
import { Confirm, Modal } from '../components/ui'
import CashierPanel from '../components/CashierPanel'
import OpenRoomModal from '../components/OpenRoomModal'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import './board.css'
import Icon from '../components/Icon'

// State always has a text label in addition to its restrained color cue.
const STATUS_STYLE: Record<string, { bg: string; text: string; accent: string; label: string }> = {
  idle: { bg: '#dcf4e3', text: '#16532b', accent: '#279650', label: '空闲' },
  occupied: { bg: '#dcecff', text: '#17457b', accent: '#337bcb', label: '使用中' },
  cleaning: { bg: '#fff0c2', text: '#775016', accent: '#d69a20', label: '待打扫' },
  reserved: { bg: '#eedfff', text: '#61368a', accent: '#9860c6', label: '已预约' },
  maintenance: { bg: '#ffe0de', text: '#8a3430', accent: '#cf6058', label: '维修' }
}

const TECH_FILTER_TABS = [
  { key: 'all',     label: '全部' },
  { key: 'on',      label: '待钟' },
  { key: 'serving', label: '上钟' },
  { key: 'rest',    label: '中休' },
  { key: 'off',     label: '未打卡' }
]

export default function Board(props: {
  onNav?: (page: 'board' | 'orders' | 'technicians' | 'items' | 'members' | 'reservations' | 'reports' | 'shift' | 'settings') => void
  pendingCount?: number
}): JSX.Element {
  const user = useAuth((s) => s.user)!
  const [rooms, setRooms] = useState<Room[]>([])
  const [loadError,setLoadError]=useState(''),[lastLoaded,setLastLoaded]=useState<number|null>(null)
  const [attentionOnly,setAttentionOnly]=useState(false)
  const needsAttention=(room:Room)=>room.status==='cleaning'||(room.status==='occupied'&&(!(room.services?.length)||room.services.every(s=>s.state==='COMPLETED')||room.services.some(s=>serviceStatus(s).urgent)))
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [activeOrderId, setActiveOrderId] = useState<number | null>(null)
  const [openedOrder, setOpenedOrder] = useState<Order | undefined>()
  useEffect(() => { if (openedOrder && openedOrder.id !== activeOrderId) setOpenedOrder(undefined) }, [activeOrderId, openedOrder])
  const [openRoomId, setOpenRoomId] = useState<number | null>(null)
  const [showCardLookup, setShowCardLookup] = useState(false)
  const [cardInput, setCardInput] = useState('')
  const [cardResult, setCardResult] = useState<Awaited<ReturnType<typeof api.resolveWristband>> | null>(null)
  const [cardError, setCardError] = useState('')
  const cardRequest = useRef(0)
  const lookupCard = async (): Promise<void> => {
    const request = ++cardRequest.current
    setCardResult(null); setCardError('')
    try { const result = await api.resolveWristband(cardInput); if (request === cardRequest.current) setCardResult(result) }
    catch (error) { if (request === cardRequest.current) setCardError(error instanceof Error ? error.message : '读卡查询失败') }
  }
  const [cleanTarget, setCleanTarget] = useState<Room | null>(null)
  const [tick, setTick] = useState(0)

  // 筛选状态
  const [filterType, setFilterType] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState('total')
  const [compact, setCompact] = useState(() => localStorage.getItem('zuyu:board-density') === 'compact')
  const [filterArea, setFilterArea] = useState<string>('all')
  const [filterKeyword, setFilterKeyword] = useState('')
  const [filterCustomer, setFilterCustomer] = useState('')
  const [techFilter, setTechFilter] = useState<string>('all')
  const [techLevel, setTechLevel] = useState<string>('all')
  const [techSearch, setTechSearch] = useState('')
  const [techSortBy, setTechSortBy] = useState<string>('queue')
  const [techSortDir, setTechSortDir] = useState<string>('asc')
  const [techShowOff, setTechShowOff] = useState(true)
  const [rightPanelVisible, setRightPanelVisible] = useState(true)
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('zuyu:right-panel-width'))
    return saved >= 480 && saved <= 1200 ? saved : 760
  })
  const [windowWidth, setWindowWidth] = useState<number>(() => window.innerWidth)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ room: Room; x: number; y: number } | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ room: Room; status: string } | null>(null)
  // 技师右键菜单 + 今日安排
  const [techMenu, setTechMenu] = useState<{ tech: Technician; x: number; y: number } | null>(null)
  const [techPlan, setTechPlan] = useState<{ tech: Technician; rows: any[]; loading: boolean } | null>(null)
  // 取消预约确认（应用内）
  const [rsvCancel, setRsvCancel] = useState<any | null>(null)
  // 巡房
  const [showPatrol, setShowPatrol] = useState(false)
  const [patrolLatest,setPatrolLatest]=useState<any[]>([])
  const [patrolBusy,setPatrolBusy]=useState(false),[patrolError,setPatrolError]=useState('')
  const patrolRunning=useRef(false),patrolPending=useRef<{body:{room_id:number;status:'normal'|'issue';remark?:string;expected_id:number};key:string}|null>(null)
  const [patrolUnknown,setPatrolUnknown]=useState(false)
  const [patrolRecords, setPatrolRecords] = useState<any[]>([])
  const [patrolSummary, setPatrolSummary] = useState<{ total: number; issues: number }>({ total: 0, issues: 0 })
  const [patrolIssueRoom, setPatrolIssueRoom] = useState<{ room: Room; remark: string } | null>(null)
  // 技师栏可拖拽调整高度（vh，12~70）
  const [techPanelHeight, setTechPanelHeight] = useState<number>(() => {
    const saved = Number(localStorage.getItem('zuyu:tech-panel-height'))
    return saved >= 12 && saved <= 70 ? saved : 29
  })
  const techResizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const techHeightRef = useRef(techPanelHeight)

  const startTechResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    techResizeRef.current = { startY: e.clientY, startH: techPanelHeight }
    const onMove = (ev: MouseEvent): void => {
      if (!techResizeRef.current) return
      const dy = techResizeRef.current.startY - ev.clientY
      const newH = Math.max(12, Math.min(70, techResizeRef.current.startH + (dy / window.innerHeight) * 100))
      techHeightRef.current = newH
      setTechPanelHeight(newH)
    }
    const onUp = (): void => {
      techResizeRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      localStorage.setItem('zuyu:tech-panel-height', String(Math.round(techHeightRef.current)))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 巡房：加载今日记录 + 标记房间
  const openPatrol = async (): Promise<void> => {
    setShowPatrol(true)
    const sequence=++loadSequence.current
    const d = await api.patrols()
    if(sequence!==loadSequence.current||patrolRunning.current)return
    setPatrolRecords(d.list || []);setPatrolLatest(d.latest || [])
    setPatrolSummary(d.summary || { total: 0, issues: 0 })
  }

  const markPatrol = async (room: Room, status: 'normal' | 'issue', remark?: string): Promise<void> => {
    if(patrolRunning.current)return
    if(status==='issue'&&!remark?.trim()){setPatrolError('请填写异常说明');return}
    patrolRunning.current=true;setPatrolBusy(true);setPatrolError('');loadSequence.current++
    const pending=patrolPending.current??{body:{room_id:room.id,status,remark,expected_id:patrolLatest.find(p=>p.room_id===room.id)?.id??0},key:crypto.randomUUID()};patrolPending.current=pending
    try{
      const res=await api.patrol(pending.body,pending.key)
      if(!res.ok){setPatrolUnknown(res.code==='RESULT_UNKNOWN');if(res.code!=='RESULT_UNKNOWN')patrolPending.current=null;setPatrolError(res.msg||'巡房保存失败');return}
      loadSequence.current++;patrolPending.current=null;setPatrolUnknown(false);setPatrolRecords(res.list);setPatrolLatest(res.latest);setPatrolSummary(res.summary);setPatrolIssueRoom(null)
      toast(pending.body.status==='normal'?'巡房正常已记录':'巡房异常已记录')
    }catch(e){setPatrolUnknown(true);setPatrolError(e instanceof Error?e.message:'结果尚未确认')}
    finally{patrolRunning.current=false;setPatrolBusy(false)}
  }

  const loadSequence = useRef(0)
  useEffect(() => () => { loadSequence.current++ }, [])
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    const revision = useRealtime.getState().version
    try {
      const [r, t] = await Promise.all([api.listRooms(), api.listTechnicians()])
      if (sequence !== loadSequence.current || revision !== useRealtime.getState().version) return
      setRooms(r)
      setTechnicians(t)
      // 同步刷新今日巡房记录（跨端巡房异常实时反映到看板）
      try {
        const d = await api.patrols()
        if (sequence !== loadSequence.current || revision !== useRealtime.getState().version) return
        setPatrolRecords(d.list || []);setPatrolLatest(d.latest || [])
        setPatrolSummary(d.summary || { total: 0, issues: 0 })
      } catch { /* 巡房失败不影响房态读取 */ }
    } catch {
      if (sequence === loadSequence.current && revision === useRealtime.getState().version) setLoadError('房态刷新失败，以下为上次数据，请刷新核对')
    }
  }, [])

  // 数据联动：App 全局收到广播 bump 后本页立即刷新；30s 轮询兜底（历史缺挂载导致跨机操作看板不刷新）
  useAutoRefresh(load)

  // 房态计时是本地派生显示，每 5 秒重绘一次，跨分钟时无需等待接口轮询。
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])

  // 分隔条宽度持久化
  useEffect(() => {
    localStorage.setItem('zuyu:right-panel-width', String(rightPanelWidth))
  }, [rightPanelWidth])

  // 窗口宽度监听（窄屏自适应）
  useEffect(() => {
    const onResize = (): void => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 窄屏（<1280px）时收银面板改为覆盖式，避免挤压看板
  const isNarrow = windowWidth < 1280

  const refresh = async (): Promise<void> => { await load() }

  // 派生：房型/区域选项
  const roomTypes = useMemo(() => {
    const set = new Set<string>()
    rooms.forEach((r) => { if (r.room_type) set.add(r.room_type) })
    return Array.from(set)
  }, [rooms])

  const roomAreas = useMemo(() => {
    const set = new Set<string>()
    rooms.forEach((r) => {
      const m = r.room_no.match(/^(\d?)\d{2}/)
      if (m && m[1]) set.add(m[1] + '层')
      else if (r.room_no.startsWith('大厅')) set.add('大厅')
      else if (r.room_no.startsWith('贵宾')) set.add('贵宾')
    })
    return Array.from(set)
  }, [rooms])

  // 统计
  const stats = useMemo(() => {
    const counts: { idle: number; occupied: number; cleaning: number; reserved: number; maintenance: number } = {
      idle: 0, occupied: 0, cleaning: 0, reserved: 0, maintenance: 0
    }
    rooms.forEach((r) => {
      if (r.status in counts) counts[r.status as keyof typeof counts]++
    })
    return { total: rooms.length, ...counts }
  }, [rooms])

  // 筛选后的房间
  const filteredRooms = useMemo(() => {
    return rooms
      .filter((r) => {
        if (attentionOnly&&!needsAttention(r))return false
        if (filterStatus !== 'total' && r.status !== filterStatus) return false
        if (filterType !== 'all' && r.room_type !== filterType) return false
        if (filterArea !== 'all') {
          const m = r.room_no.match(/^(\d?)\d{2}/)
          const area = m && m[1] ? m[1] + '层' : r.room_no.startsWith('大厅') ? '大厅' : r.room_no.startsWith('贵宾') ? '贵宾' : ''
          if (area !== filterArea) return false
        }
        if (filterKeyword) {
          const kw = filterKeyword.toLowerCase()
          if (!r.room_name.toLowerCase().includes(kw) && !r.room_no.toLowerCase().includes(kw)) return false
        }
        if (filterCustomer && !(r.customer_name || '').toLowerCase().includes(filterCustomer.toLowerCase())) return false
        return true
      })
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  }, [rooms, filterType, filterArea, filterKeyword, filterCustomer, filterStatus, attentionOnly, tick])

  // 按状态 + 等级 + 搜索筛选后的技师（支持排序 + 显示未上钟开关）
  const filteredTechs = useMemo(() => {
    const kw = techSearch.trim().toLowerCase()
    const list = technicians
      .filter((t) => techFilter === 'all' || t.status === techFilter)
      .filter((t) => techLevel === 'all' || t.level === techLevel)
      .filter((t) => {
        if (!kw) return true
        return t.name.toLowerCase().includes(kw) || t.code.toLowerCase().includes(kw)
      })
      .filter((t) => techShowOff || t.status !== 'off')
    return [...list].sort((a, b) => {
      // 上钟中排最后
      const aServing = a.status === 'serving' ? 1 : 0
      const bServing = b.status === 'serving' ? 1 : 0
      if (aServing !== bServing) return aServing - bServing
      let cmp = 0
      if (techSortBy === 'code') {
        cmp = (a.code || '').localeCompare(b.code || '', undefined, { numeric: true })
      } else {
        // 自动轮钟：可服务技师按当天已上钟数从少到多排列；手动队列仅作为同钟数时的次级排序。
        cmp = (a.served_today ?? 0) - (b.served_today ?? 0) || (a.queue_position ?? 0) - (b.queue_position ?? 0)
      }
      return techSortDir === 'desc' ? -cmp : cmp
    })
  }, [technicians, techFilter, techLevel, techSearch, techShowOff, techSortBy, techSortDir])

  // 按等级分组
  const techsByLevel = useMemo(() => {
    const groups: Record<string, Technician[]> = {}
    filteredTechs.forEach((t) => {
      const lv = t.level || '普通'
      if (!groups[lv]) groups[lv] = []
      groups[lv].push(t)
    })
    return TECH_LEVELS
      .map((lv) => ({ level: lv, list: groups[lv] || [] }))
      .filter((g) => g.list.length > 0)
  }, [filteredTechs])

  // 当前存在的等级
  const availableLevels = useMemo(() => {
    const set = new Set<string>()
    technicians.forEach((t) => { if (t.level) set.add(t.level) })
    return Array.from(set)
  }, [technicians])

  // 占用中的房间（用于右栏单据切换器）
  const occupiedRooms = useMemo(
    () => rooms.filter((r) => r.status === 'occupied' && r.order_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    [rooms]
  )

  const handleRoomClick = (room: Room): void => {
    if (room.status === 'occupied' && room.order_id) {
      setActiveOrderId(room.order_id)
    } else if (room.status === 'idle') {
      if(!canOperate(user,'openOrder')){toast('当前账号未授权开房','error');return}
      setOpenRoomId(room.id)
    } else if (room.status === 'cleaning') {
      if(!canOperate(user,'roomStatus')){toast('当前账号未授权房态维护','error');return}
      setCleanTarget(room)
    } else if (room.status === 'reserved') {
      // 已预约房间：弹出该房预约，可"到店开房/取消预约"
      void openRoomAppointment(room)
    }
  }

  // 预约房处理：查该房待来店预约 → 弹操作卡
  const [reservedInfo, setReservedInfo] = useState<{ room: Room; rsv: any | null; loading: boolean } | null>(null)
  const openRoomAppointment = async (room: Room): Promise<void> => {
    setReservedInfo({ room, rsv: null, loading: true })
    try {
      const list = await api.listReservations('pending')
      const rsv = (list || []).find((r) => Number(r.room_id) === room.id)
      setReservedInfo({ room, rsv: rsv || null, loading: false })
    } catch {
      setReservedInfo({ room, rsv: null, loading: false })
    }
  }

  // 到店并开房（预约 → 开房，直接进收银）
  const doArriveOpen = async (rsv: any): Promise<void> => {
    try {
      const res = await api.arriveAndOpen(rsv.id,rsv.version)
      setReservedInfo(null)
      if (res.ok !== false && res.id) {
        setActiveOrderId(Number(res.id))
        toast(`已到店开房：${reservedInfo?.room?.room_name || ''}`)
      } else {
        toast(res.msg || '开房失败，请到预约页处理', 'error')
      }
      await refresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : '开房失败', 'error')
      setReservedInfo(null)
      await refresh()
    }
  }

  // 取消预约（释放房间为空闲）
  const doCancelRsv = async (rsv: any): Promise<void> => {
    const res = await api.setReservationStatus(rsv.id, 'cancelled', user.id,rsv.version)
    if (res.ok) toast('预约已取消，房间已释放')
    else toast(res.msg || '取消失败', 'error')
    setReservedInfo(null)
    await refresh()
  }

  const handleQuickClean = async (room: Room): Promise<boolean> => {
    const res = await api.setRoomStatus(room.id, 'idle', user.id)
    if (!res.ok) { toast(res.msg || '操作失败', 'error'); return false }
    setRooms(current => current.map(r => r.id === room.id ? {...r, status: 'idle'} : r))
    toast('房态已更新')
    // remote() already requests a refresh. Close on the authoritative write ACK,
    // not after unrelated snapshot and patrol requests finish.
    return true
  }

  // 右栏拖拽分隔条
  const onDragMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: rightPanelWidth }
    const onMove = (ev: MouseEvent): void => {
      if (!dragRef.current) return
      const delta = ev.clientX - dragRef.current.startX
      const next = Math.max(480, Math.min(1200, dragRef.current.startW - delta))
      setRightPanelWidth(next)
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 右键菜单
  const onRoomContextMenu = (e: React.MouseEvent, room: Room): void => {
    e.preventDefault()
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 200)
    setContextMenu({ room, x, y })
  }

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [contextMenu])

  // —— 技师右键菜单 ——
  const onTechContextMenu = (e: React.MouseEvent, tech: Technician): void => {
    e.preventDefault()
    setContextMenu(null)
    const x = Math.min(e.clientX, window.innerWidth - 220)
    const y = Math.min(e.clientY, window.innerHeight - 240)
    setTechMenu({ tech, x, y })
  }

  useEffect(() => {
    if (!techMenu) return
    const close = (): void => setTechMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [techMenu])

  const clockTech = async (t: Technician): Promise<void> => {
    const res = await api.clockTechnician(t.id, user.id)
    if (res.ok) toast(res.status === 'on' ? `${t.name} 已打卡上班` : `${t.name} 已打卡下班`)
    else toast('打卡失败，请稍后重试', 'error')
    await refresh()
  }

  const openTechPlan = async (t: Technician): Promise<void> => {
    setTechPlan({ tech: t, rows: [], loading: true })
    try {
      const all = await api.listReservations('all')
      const d = today()
      const rows = (all || [])
        .filter((r) => Number(r.technician_id) === t.id)
        .map((r) => {
          const room = rooms.find((x) => x.id === Number(r.room_id))
          return {
            id: r.id,
            customer_name: r.customer_name || '',
            customer_phone: r.customer_phone || '',
            room_name: room?.room_name || room?.room_no || '',
            reserve_time: String(r.reserve_time || '').replace('T', ' ').slice(0, 16),
            people: Number(r.people) || 1,
            status: r.status,
            is_today: String(r.reserve_time || '').startsWith(d)
          }
        })
        .sort((a, b) => (a.reserve_time < b.reserve_time ? 1 : -1))
      setTechPlan({ tech: t, rows, loading: false })
    } catch {
      setTechPlan({ tech: t, rows: [], loading: false })
    }
  }

  const changeRoomStatus = async (room: Room, status: string): Promise<boolean> => {
    const res = await api.setRoomStatus(room.id, status, user.id)
    if (!res.ok) { toast(res.msg || '操作失败', 'error'); return false }
    setRooms(current => current.map(r => r.id === room.id ? {...r, status: status as Room['status']} : r))
    toast(`房间已设为${STATUS_STYLE[status]?.label || status}`)
    return true
  }

  // 顶部图例数据
  const legend = [
    { key: 'total', label: '全部房', value: stats.total, color: '#0f172a' },
    { key: 'idle', label: '空闲', value: stats.idle, color: STATUS_STYLE.idle.accent },
    { key: 'occupied', label: '使用中', value: stats.occupied, color: STATUS_STYLE.occupied.accent },
    { key: 'cleaning', label: '待打扫', value: stats.cleaning, color: STATUS_STYLE.cleaning.accent },
    { key: 'reserved', label: '已预约', value: stats.reserved, color: STATUS_STYLE.reserved.accent },
    { key: 'maintenance', label: '维修', value: stats.maintenance, color: STATUS_STYLE.maintenance.accent }
  ]

  // 顶部按钮组配置
  const quickActions: { key: string; label: string; page?: 'orders' | 'reservations' | 'settings' | 'board'; onClick?: () => void }[] = [
    { key: 'cashier',   label: '收银',    page: 'orders' },
    { key: 'reception', label: '会宾',    page: 'reservations' },
    { key: 'pending',   label: `待处理(${rooms.filter(needsAttention).length})`, onClick:()=>{setAttentionOnly(v=>!v);setFilterStatus('total');setFilterType('all');setFilterArea('all');setFilterKeyword('');setFilterCustomer('')} },
    { key: 'room',      label: rightPanelVisible ? '隐藏右栏' : '显示右栏', onClick: () => setRightPanelVisible((v) => !v) },
    { key: 'patrol',    label: '巡房', onClick: () => void openPatrol().catch(()=>setPatrolError('巡房记录读取失败，请重试')) },
    { key: 'wristband', label: '手牌',    page: 'settings' },
    { key: 'tools',     label: '工具',    page: 'settings' }
  ]

  return (
    <div className="board-shell h-full flex" data-density={compact ? 'compact' : 'comfortable'}>
      {/* 左侧：房态看板主区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {loadError&&<p role="alert" className="px-5 py-2 bg-red-50 text-red-700">{loadError}</p>}
        {lastLoaded&&<p className="px-5 pt-2 text-xs text-gray-500">最近同步 {new Date(lastLoaded).toLocaleTimeString()} · {attentionOnly?'正在查看待接单、待上钟、临近到时、超时及待打扫房间':'点击待处理可集中处理营业提醒'}</p>}
        {['owner','manager','support'].includes(user.role)&&<OperatingAlerts onNav={props.onNav}/>}
        {/* 顶部工具条 */}
        <div className="board-header shrink-0">
          <div className="board-title-row"><div><span className="board-eyebrow">LIVE OPERATIONS</span><h2>房态看板</h2><p>房间动态与技师安排，一目了然。</p></div><div className="board-occupancy"><strong>{stats.total ? Math.round(stats.occupied / stats.total * 100) : 0}<small>%</small></strong><span>房间使用率</span></div></div>
          <div className="board-status-filters" aria-label="房间状态筛选">
          {legend.map((item) => (
            <button key={item.key} aria-pressed={filterStatus === item.key} onClick={() => setFilterStatus(item.key)} className="board-status-filter">
              <span className="board-status-label"><i style={{ backgroundColor: item.color }}/>{item.label}</span><strong>{item.value.toString().padStart(2, '0')}</strong>
            </button>
          ))}
          </div>
          <div className="board-filters">
          <select
            aria-label="房间类型"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-sky-400"
          >
            <option value="all">类型 ▼</option>
            {roomTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            aria-label="房间区域"
            value={filterArea}
            onChange={(e) => setFilterArea(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-sky-400"
          >
            <option value="all">区域 ▼</option>
            {roomAreas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input
            type="text"
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            placeholder="搜索房号 / 房名"
            aria-label="搜索房号或房名"
            className="text-xs border border-gray-300 rounded px-2 py-1 w-24 bg-white focus:outline-none focus:border-sky-400"
          />
          <input
            type="text"
            value={filterCustomer}
            onChange={(e) => setFilterCustomer(e.target.value)}
            placeholder="预定顾客"
            className="text-xs border border-gray-300 rounded px-2 py-1 w-24 bg-white focus:outline-none focus:border-sky-400"
          />
          </div>
          <div className="board-actions">
            <button onClick={() => { setCardInput(''); setCardResult(null); setCardError(''); setShowCardLookup(true) }}>刷手牌查房</button>
            <button aria-pressed={!compact} onClick={() => { setCompact(!compact); localStorage.setItem('zuyu:board-density', compact ? 'comfortable' : 'compact') }}>{compact ? '舒适视图' : '紧凑视图'}</button>
            {quickActions.map((a) => (
              <button
                key={a.key}
                onClick={() => {
                  if (a.onClick) {
                    a.onClick()
                  } else if (a.page && props.onNav) {
                    props.onNav(a.page)
                  }
                }}
                className="px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded"
              >
                {a.label}
              </button>
            ))}
            <button
              onClick={load}
              className="ml-1 px-2.5 py-1 text-xs text-white bg-sky-500 hover:bg-sky-600 rounded"
            >
              <Icon name="refresh" size={13}/>刷新
            </button>
          </div>
        </div>

        {/* 房间网格 */}
        <div className="board-room-area flex-1 overflow-y-auto">
          {filteredRooms.length === 0 ? (
            <div className="board-empty h-full flex flex-col items-center justify-center text-sm text-gray-400">
              <div className="empty-state-icon"><Icon name="board" size={25}/></div><strong>{rooms.length ? '没有符合条件的房间' : '从第一间房，开始有序经营'}</strong><p>{rooms.length ? '请调整状态或搜索条件' : '在门店设置中添加房间，即可开始接待。'}</p>
              <button className="btn-secondary" onClick={() => { setFilterStatus('total'); setFilterType('all'); setFilterArea('all'); setFilterKeyword(''); setFilterCustomer('') }}>清除筛选</button>
            </div>
          ) : (
            <div className="board-room-grid">
              {filteredRooms.map((room) => {
                const style = STATUS_STYLE[room.status] || {bg:'#f3f4f6',text:'#374151',accent:'#6b7280',label:'状态待确认'}
                const elapsed = elapsedMinutes(room.opened_at)
                // 当天可能先报异常、后恢复正常；房间状态必须以最新一条巡房记录为准。
                const latestPatrol = patrolLatest.find((p) => p.room_id === room.id)
                const patrolIssue = latestPatrol?.status === 'issue' ? latestPatrol : null
                const tipText = [
                  `${room.room_name}（${room.room_type}）`,
                  `状态：${style.label}`,
                  patrolIssue ? `⚠ 巡房异常：${patrolIssue.remark || '未备注'}` : '',
                  room.status === 'occupied' ? `技师：${room.technician_name || '未派'}（${room.technician_code || '-'}）` : '',
                  room.status === 'occupied' ? `手牌：${room.wristband_no || '-'}` : '',
                  room.status === 'occupied' ? `开房时长：${fmtDuration(elapsed)}` : '',
                  room.status === 'occupied' ? `消费：${fmtMoney(room.subtotal)}` : '',
                  room.customer_name ? `顾客：${room.customer_name}` : ''
                ].filter(Boolean).join('\n')
                return (
                  <button
                    key={room.id}
                    onClick={() => handleRoomClick(room)}
                    onContextMenu={(e) => onRoomContextMenu(e, room)}
                    className="board-room-card text-left relative"
                    data-status={room.status}
                    aria-label={`房间 ${room.room_no}，${style.label}`}
                    style={{ backgroundColor: style.bg, color: style.text, borderTopColor: style.accent }}
                    title={tipText}
                  >
                    <div className="board-room-card-heading"><div className="board-room-number">
                      {room.room_no}
                    </div><span className="board-room-state">{style.label}</span></div>
                    <div className="board-room-type">
                      {room.room_type}
                    </div>
                    {patrolIssue && <span className="board-room-alert" title={patrolIssue.remark || '巡房异常'}>巡房异常</span>}
                    {room.status === 'occupied' ? (
                      <div className="board-room-service">
                        <div className="board-room-technician">
                          {room.technician_code ? `${room.technician_code}号 · ` : ''}{room.technician_name || '待派技师'}
                        </div>
                        <div className="board-room-totals">
                          <span>开房 {fmtDuration(elapsed)}</span>
                          <span className="font-semibold">{fmtMoney(room.subtotal)}</span>
                        </div>
                        {room.services?.map((service,index)=>{const status=serviceStatus(service);return <div key={index} className={status.urgent?'board-room-alert':'text-xs mt-1'}>{service.name} · {service.duration}分钟 · {status.label}</div>})}
                        {room.services?.length&&room.services.every(s=>s.state==='COMPLETED')?<div className="board-room-alert">服务已结束 · 待结账</div>:null}
                        {!room.services?.length&&<div className="board-room-alert">尚未添加服务项目</div>}
                      </div>
                    ) : room.status === 'idle' ? (
                      <div className="board-room-hint">点击开房 <span aria-hidden="true">＋</span></div>
                    ) : room.status === 'cleaning' ? (
                      <div className="board-room-hint">清扫完成 → 空闲</div>
                    ) : room.status === 'reserved' ? (
                      <div className="board-room-hint">查看预约 →</div>
                    ) : (
                      <div className="board-room-hint">{style.label}</div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部技师栏：可拖拽调整高度（拖动顶边手柄） */}
        <div className="board-tech-panel relative bg-white border-t border-gray-200 shrink-0 flex flex-col" style={{ height: `${techPanelHeight}vh`, minHeight: '180px' }}>
          <div
            onMouseDown={startTechResize}
            role="separator" aria-label="调整技师栏高度" aria-orientation="horizontal" tabIndex={0}
            aria-valuemin={12} aria-valuemax={70} aria-valuenow={Math.round(techPanelHeight)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
              event.preventDefault()
              const next = Math.max(12, Math.min(70, techPanelHeight + (event.key === 'ArrowUp' ? 5 : -5)))
              setTechPanelHeight(next); localStorage.setItem('zuyu:tech-panel-height', String(next))
            }}
            className="absolute -top-1 left-0 right-0 h-2.5 cursor-ns-resize hover:bg-brand-200/50 transition-colors rounded-b z-10"
            title="拖动调整技师栏高度"
          />
          <div className="board-tech-title"><h3>技师安排</h3><span>点击卡片查看今日安排 · 右键更多操作</span></div>
          <div className="board-tech-filters flex items-center gap-2 mb-2 flex-wrap">
            {TECH_FILTER_TABS.map((tab) => {
              const count = tab.key === 'all'
                ? technicians.length
                : technicians.filter((t) => t.status === tab.key).length
              const active = techFilter === tab.key
              return (
                <button
                  key={tab.key}
                  aria-pressed={active}
                  onClick={() => setTechFilter(tab.key)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors ${
                    active
                      ? 'bg-sky-500 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {tab.label}({count})
                </button>
              )
            })}
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <select
              value={techLevel}
              aria-label="技师等级"
              onChange={(e) => setTechLevel(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-sky-400"
            >
              <option value="all">等级 ▼</option>
              {availableLevels.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
            </select>
            <input
              type="text"
              value={techSearch}
              onChange={(e) => setTechSearch(e.target.value)}
              placeholder="搜索技师"
              className="text-xs border border-gray-300 rounded px-2 py-1 w-20 bg-white focus:outline-none focus:border-sky-400"
            />
            <div className="flex-1" />
            <select
              value={techSortBy}
              aria-label="技师排序方式"
              onChange={(e) => setTechSortBy(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-sky-400"
            >
              <option value="queue">下钟顺序</option>
              <option value="code">工号顺序</option>
            </select>
            <select
              value={techSortDir}
              aria-label="技师排序方向"
              onChange={(e) => setTechSortDir(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-sky-400"
            >
              <option value="asc">升序 ▲</option>
              <option value="desc">降序 ▼</option>
            </select>
            <label className="text-xs text-gray-500 flex items-center gap-1">
              <input
                type="checkbox"
                className="w-3 h-3"
                checked={techShowOff}
                onChange={(e) => setTechShowOff(e.target.checked)}
              /> 显示未上钟
            </label>
          </div>

          {/* 按等级分组显示（占满技师栏剩余空间） */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5">
            {techsByLevel.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-3">
                暂无符合条件的技师
              </div>
            ) : (
              techsByLevel.map((group) => (
                <div key={group.level} className="flex items-start gap-2">
                  <div className="shrink-0 w-16 pt-1">
                    <span
                      className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        group.level === '特级' ? 'bg-red-100 text-red-700'
                          : group.level === '明星' ? 'bg-amber-100 text-amber-700'
                          : group.level === '金牌' ? 'bg-violet-100 text-violet-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {group.level}·{group.list.length}
                    </span>
                  </div>
                  <div className="board-tech-grid flex-1 min-w-0">
                    {group.list.map((t) => {
                      const st = TECH_STATUS[t.status] || TECH_STATUS.off
                      return (
                        <button
                          key={t.id}
                          onClick={() => void openTechPlan(t)}
                          onContextMenu={(e) => onTechContextMenu(e, t)}
                          className="board-tech-card text-left flex flex-col justify-between"
                          data-status={t.status}
                          title={`${t.code}号 ${t.name}（${t.level}） · ${st.label}${(t.reserved_today || 0) > 0 ? ` · 今日预约 ${t.reserved_today} 场` : ''}${t.current_room ? ` · 房间 ${t.current_room}` : ''}（右键更多操作）`}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div className="text-[20px] font-bold leading-none text-gray-800 tracking-tight">{t.code}</div>
                            <span className={`inline-flex items-center gap-1 text-[10px] shrink-0 ${st.color}`}>
                              <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                              {st.label}
                            </span>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-800 truncate">{t.name}</div>
                            <div className="board-tech-meta flex items-center justify-between mt-0.5">
                              <span>{t.level}</span>
                              <span className="flex items-center gap-1">
                                {t.current_room && <span className="truncate max-w-[5rem]">📍{t.current_room}</span>}
                                {(t.reserved_today || 0) > 0 && <span className="text-violet-500">📅{t.reserved_today}</span>}
                                {t.serving_count != null && t.serving_count > 0 && <span>⏱{t.serving_count}</span>}
                              </span>
                            </div>
                          </div>
                          {t.served_today != null && <div className="board-tech-today">今日已上钟 <strong>{t.served_today}</strong></div>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 开房弹窗 */}
        <Modal open={showCardLookup} title="刷手牌查房" onClose={() => { cardRequest.current++; setShowCardLookup(false) }}>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); void lookupCard() }}>
            <label className="label">手牌号或芯片卡号<input aria-label="刷卡原始值" className="input" value={cardInput} onChange={e => { cardRequest.current++; setCardInput(e.target.value); setCardResult(null); setCardError('') }} placeholder="点击这里后刷卡，或手动输入" /></label>
            <p className="text-xs text-gray-500">查询不会开房、上下钟或收款。读卡器是否能模拟键盘输入，需连接实机确认。</p>
            <button type="submit" className="btn-primary">查询对应房间</button>
          </form>
          {cardError && <p role="alert" className="text-red-600 mt-3">{cardError}</p>}
          {cardResult && <div className="card p-3 mt-3 space-y-2">
            <p>手牌 {cardResult.code} → {cardResult.room_name || cardResult.room_no}</p>
            <p>{STATUS_STYLE[cardResult.status]?.label || cardResult.status}{cardResult.order_id ? ' · 有进行中账单' : ' · 当前无进行中账单'}</p>
            {cardResult.order_id && <button className="btn-secondary" onClick={() => { setActiveOrderId(cardResult.order_id); setShowCardLookup(false) }}>查看当前账单</button>}
          </div>}
        </Modal>
        <OpenRoomModal
          roomId={openRoomId}
          onClose={() => setOpenRoomId(null)}
          onDone={(orderId, order) => {
            setOpenRoomId(null)
            setOpenedOrder(order)
            if (orderId) setActiveOrderId(orderId)
          }}
        />

        {/* 设空闲确认 */}
        <Confirm
          open={!!cleanTarget}
          title="设为空闲"
          message={`确认将房间「${cleanTarget?.room_name || ''}」设为空闲？`}
          onCancel={() => setCleanTarget(null)}
          onConfirm={async () => {
            if (cleanTarget && await handleQuickClean(cleanTarget)) setCleanTarget(null)
          }}
        />
      </div>

      {/* 窄屏（<1280px）：收银面板覆盖式，避免挤压看板 */}
      {isNarrow && rightPanelVisible && activeOrderId && (
        <CashierPanel key={activeOrderId}
          orderId={activeOrderId}
          initialOrder={openedOrder}
          onClose={async () => {
            setActiveOrderId(null)
            await refresh()
          }}
        />
      )}

      {/* 宽屏：双屏并排收银面板（点占用房时显示） */}
      {!isNarrow && rightPanelVisible && activeOrderId ? (
        <>
          <div
            className="w-1 shrink-0 bg-gray-200 hover:bg-sky-400 cursor-col-resize transition-colors"
            onMouseDown={onDragMouseDown}
            title="拖拽调整宽度"
          />
          <div
            className="shrink-0 border-l border-gray-200 shadow-2xl flex flex-col bg-white"
            style={{ width: rightPanelWidth }}
          >
            {/* 占用房间单据切换器 */}
            {occupiedRooms.length > 1 && (
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 overflow-x-auto shrink-0 bg-gray-50">
                <span className="text-[10px] text-gray-400 mr-1 shrink-0">切单</span>
                {occupiedRooms.map((room) => {
                  const isActive = room.order_id === activeOrderId
                  return (
                    <button
                      key={room.id}
                      onClick={() => room.order_id && setActiveOrderId(room.order_id)}
                      className={`px-2 py-1 rounded text-xs whitespace-nowrap shrink-0 transition-colors ${
                        isActive
                          ? 'bg-sky-500 text-white'
                          : 'bg-white border border-gray-200 text-gray-600 hover:bg-sky-50'
                      }`}
                    >
                      {room.room_name}
                      {room.technician_name ? `·${room.technician_name}` : ''}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="flex-1 flex flex-col min-h-0">
              <CashierPanel key={activeOrderId}
                orderId={activeOrderId}
                initialOrder={openedOrder}
                inline
                onClose={async () => {
                  setActiveOrderId(null)
                  await refresh()
                }}
              />
            </div>
          </div>
        </>
      ) : !isNarrow && rightPanelVisible ? (
        <div className="board-quick-panel w-[260px] shrink-0 border-l border-gray-200 bg-white hidden xl:flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">快捷操作</span>
          </div>
          <div className="flex-1 p-4 space-y-2 overflow-y-auto">
            <button
              onClick={() => {
                const idleRoom = rooms.find((r) => r.status === 'idle')
                if (idleRoom) setOpenRoomId(idleRoom.id)
                else toast('当前没有空闲房间')
              }}
              className="board-quick-primary" disabled={!canOperate(user,'openOrder')}
            >
              <Icon name="plus" size={18}/>快速开房
            </button>
            <button
              onClick={() => props.onNav?.('orders')}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 text-left"
            >
              <Icon name="orders" size={17}/>查看所有账单
            </button>
            <button
              onClick={() => props.onNav?.('reservations')}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 text-left"
            >
              <Icon name="reservations" size={17}/>预约登记
            </button>
            <button
              onClick={() => props.onNav?.('members')}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 text-left"
            >
              <Icon name="members" size={17}/>会员管理
            </button>
            <button
              onClick={() => props.onNav?.('shift')}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 text-left"
            >
              <Icon name="shift" size={17}/>交接班
            </button>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="text-xs text-gray-400 mb-2">房态速览</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {legend.filter((l) => l.key !== 'total').map((l) => (
                  <div key={l.key} className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-50">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
                    <span className="text-gray-600">{l.label}</span>
                    <span className="ml-auto font-semibold text-gray-800">{l.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-[5000] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100">
            房间 {contextMenu.room.room_name}
          </div>
          {(['idle', 'cleaning', 'reserved', 'maintenance'] as const).map((status) => {
            const s = STATUS_STYLE[status]
            const isCurrent = contextMenu.room.status === status
            return (
              <button
                key={status}
                disabled={(isCurrent)||!canOperate(user,'roomStatus')}
                onClick={async () => {
                  setContextMenu(null)
                  if (status === 'idle' && contextMenu.room.status === 'cleaning') {
                    // 直接清洁：走原 confirm 流程
                    await changeRoomStatus(contextMenu.room, status)
                  } else if (status === 'idle' && contextMenu.room.status === 'occupied') {
                    // 占用 → 空闲：禁止（要结账后才能清房）
                    toast('占用房间需先结账', 'error')
                  } else {
                    setStatusTarget({ room: contextMenu.room, status })
                  }
                }}
                className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 ${
                  isCurrent ? 'text-gray-400 cursor-default' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: s.accent }} />
                <span>设为{s.label}</span>
                {isCurrent && <span className="ml-auto text-[10px]">当前</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* 技师右键菜单 */}
      {techMenu && (
        <div
          className="fixed z-[5200] bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[220px]"
          style={{ left: techMenu.x, top: techMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100 flex items-center justify-between gap-3">
            <span className="truncate">{techMenu.tech.code}号 {techMenu.tech.name}（{techMenu.tech.level}）</span>
            <span className={`shrink-0 ${(TECH_STATUS[techMenu.tech.status] || TECH_STATUS.off).color}`}>
              {(TECH_STATUS[techMenu.tech.status] || TECH_STATUS.off).label}
            </span>
          </div>
          <button
            className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 text-gray-700 hover:bg-gray-50"
            onClick={() => {
              const t = techMenu.tech
              setTechMenu(null)
              setPrebookTech({ id: t.id, name: `${t.code}号 ${t.name}` })
              props.onNav?.('reservations')
            }}
          >
            📅 预约该技师
          </button>
          <button
            className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 text-gray-700 hover:bg-gray-50 disabled:text-gray-300 disabled:hover:bg-transparent"
            disabled={techMenu.tech.status === 'serving' || techMenu.tech.status === 'rest'}
            onClick={() => {
              const t = techMenu.tech
              setTechMenu(null)
              void clockTech(t)
            }}
          >
            {techMenu.tech.status === 'off'
              ? '✅ 上班打卡'
              : techMenu.tech.status === 'on'
                ? '⏹ 下班打卡'
                : '⏸ 服务/中休中，暂不可打卡'}
          </button>
          <button
            className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 text-gray-700 hover:bg-gray-50"
            onClick={() => {
              const t = techMenu.tech
              setTechMenu(null)
              void openTechPlan(t)
            }}
          >
            📋 今日安排
          </button>
          {techMenu.tech.current_room && (
            <div className="px-3 py-1.5 text-[10px] text-sky-600 border-t border-gray-100">
              📍 当前房间 {techMenu.tech.current_room}
            </div>
          )}
        </div>
      )}

      {/* 技师今日安排弹窗 */}
      {techPlan && (
        <DialogLayer title="技师今日安排" onClose={() => setTechPlan(null)}>
          <div className="bg-white rounded-lg shadow-2xl w-[640px] max-w-[94vw] max-h-[80vh] flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-gray-800">
                  👩‍⚕️ {techPlan.tech.code}号 {techPlan.tech.name} · 今日安排
                </h3>
                <span className={`text-xs ${(TECH_STATUS[techPlan.tech.status] || TECH_STATUS.off).color}`}>
                  {(TECH_STATUS[techPlan.tech.status] || TECH_STATUS.off).label}
                </span>
              </div>
              <button className="text-xs text-gray-400" onClick={() => setTechPlan(null)}>✕</button>
            </div>
            <div className="px-5 pt-3 pb-1 flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">待安排 {techPlan.rows.filter((r) => r.status === 'pending' || r.status === 'arrived').length} 场</span>
              <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">今日 {techPlan.rows.filter((r) => r.is_today).length} 场</span>
              {techPlan.tech.serving_count ? <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-600">上钟 {techPlan.tech.serving_count} 项</span> : null}
              {techPlan.tech.queue_position ? <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">排钟第 {techPlan.tech.queue_position} 位</span> : null}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
              {techPlan.loading ? (
                <div className="text-sm text-gray-400 text-center py-8">加载中...</div>
              ) : techPlan.rows.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-8">暂无预约记录</div>
              ) : (
                <table className="table w-full">
                  <thead>
                    <tr><th>时间</th><th>客户</th><th>电话</th><th>房间</th><th>人数</th><th>状态</th></tr>
                  </thead>
                  <tbody>
                    {techPlan.rows.slice(0, 50).map((r) => (
                      <tr key={r.id} className={r.is_today ? '' : 'opacity-55'}>
                        <td className="whitespace-nowrap">{r.reserve_time}</td>
                        <td className="font-medium">{r.customer_name}</td>
                        <td className="text-xs">{r.customer_phone || '-'}</td>
                        <td>{r.room_name || '-'}</td>
                        <td>{r.people}人</td>
                        <td>
                          {r.status === 'pending' ? <span className="text-amber-600 text-xs">待来店</span>
                            : r.status === 'arrived' ? <span className="text-emerald-600 text-xs">已到店</span>
                            : <span className="text-gray-400 text-xs">已取消</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-2 border-t border-gray-100 text-[10px] text-gray-400">
              非今日记录已淡化显示；如需增改预约，右键「预约该技师」或到「预约登记」页操作
            </div>
          </div>
        </DialogLayer>
      )}

      {/* 设状态确认（占用中改打扫/维修/预约 时确认） */}
      <Confirm
        open={!!statusTarget}
        title="修改房态"
        message={`确认将房间「${statusTarget?.room.room_name || ''}」设为${STATUS_STYLE[statusTarget?.status || '']?.label || ''}？`}
        onCancel={() => setStatusTarget(null)}
        onConfirm={async () => {
          if (statusTarget && await changeRoomStatus(statusTarget.room, statusTarget.status)) setStatusTarget(null)
        }}
      />

      {/* 预约房间处理弹窗 */}
      {reservedInfo && (
        <DialogLayer title="预订详情" onClose={() => setReservedInfo(null)}>
          <div className="bg-white rounded-lg shadow-2xl w-96 p-5" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-lg font-bold text-gray-800">📅 已预约 · {reservedInfo.room.room_name}</div>
              <button className="text-xs text-gray-400" onClick={() => setReservedInfo(null)}>✕</button>
            </div>
            {reservedInfo.loading ? (
              <div className="text-sm text-gray-400 text-center py-6">查询预约中...</div>
            ) : reservedInfo.rsv ? (
              <>
                <div className="bg-violet-50 rounded-lg p-3 text-sm space-y-1 my-3">
                  <div className="font-semibold text-gray-800">{reservedInfo.rsv.customer_name}</div>
                  {reservedInfo.rsv.customer_phone && <div className="text-xs text-gray-500">☎ {reservedInfo.rsv.customer_phone}</div>}
                  <div className="text-xs text-gray-500">🕐 {reservedInfo.rsv.reserve_time?.replace('T', ' ').slice(0, 16)} · {reservedInfo.rsv.people}人</div>
                  {reservedInfo.rsv.technician_name && <div className="text-xs text-gray-500">👩‍⚕️ 预约技师：{reservedInfo.rsv.technician_name}</div>}
                  {reservedInfo.rsv.remark && <div className="text-xs text-gray-400">备注：{reservedInfo.rsv.remark}</div>}
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary flex-1" onClick={() => doArriveOpen(reservedInfo.rsv!)} disabled={!canOperate(user,'openOrder')}>✅ 到店并开房</button>
                  <button className="btn-secondary flex-1" onClick={() => setRsvCancel(reservedInfo.rsv!)} disabled={!canOperate(user,'reservationManage')}>
                    取消预约
                  </button>
                </div>
                <div className="text-[10px] text-gray-400 mt-2">到店开房：预约转进行中账单，直接开始点单；取消后房间恢复空闲。</div>
              </>
            ) : (
              <div className="text-sm text-gray-500 text-center py-6">该房间暂无待来店预约（可能预约已到店/取消）</div>
            )}
          </div>
        </DialogLayer>
      )}

      {/* 取消预约确认（应用内确认，非原生弹窗） */}
      <Confirm
        open={!!rsvCancel}
        title="取消预约"
        message={`确认取消「${rsvCancel?.customer_name || ''}」的预约？该房间将恢复空闲。`}
        onCancel={() => setRsvCancel(null)}
        onConfirm={async () => {
          if (rsvCancel) await doCancelRsv(rsvCancel)
          setRsvCancel(null)
        }}
      />

      {/* 巡房弹窗 */}
      {showPatrol && (
        <DialogLayer title="巡房" onClose={() => {if(!patrolBusy&&!patrolUnknown)setShowPatrol(false)}}>
          <div className="bg-white rounded-lg shadow-2xl w-[720px] max-h-[82vh] flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-gray-800">楼面巡房</h3>
                <span className="text-xs text-gray-400">今日已巡 {patrolSummary.total} 间 · 异常 {patrolSummary.issues} 间</span>
              </div>
              <button className="btn-ghost text-xs text-gray-400" disabled={patrolBusy||patrolUnknown} onClick={() => setShowPatrol(false)}>关闭</button>
            </div>
            <div className="flex-1 overflow-auto px-5 py-4">
              {patrolError&&<p role="alert" className="text-red-600 mb-3">{patrolError}</p>}
              {patrolUnknown&&<button className="btn-primary mb-3" disabled={patrolBusy} onClick={()=>{const p=patrolPending.current;if(p)void markPatrol(rooms.find(r=>r.id===p.body.room_id)!,p.body.status,p.body.remark)}}>核对原巡房结果</button>}
              <button className="btn-secondary mb-3" disabled={patrolBusy} onClick={()=>void openPatrol().catch(()=>setPatrolError('巡房记录读取失败'))}>刷新巡房记录</button>
              <div className="text-sm font-semibold text-gray-600 mb-2">房间状态（点击标记巡房结果）</div>
              <div className="grid grid-cols-4 lg:grid-cols-6 gap-2 mb-4">
                {rooms.map((r) => {
                  const latestPatrol = patrolLatest.find((p) => p.room_id === r.id)
                  const hasIssue = latestPatrol?.status === 'issue'
                  return (
                    <button
                      key={r.id}
                      disabled={patrolBusy||patrolUnknown||!canOperate(user,'roomStatus')}
                      onClick={() => markPatrol(r, 'normal')}
                      onContextMenu={(e) => { e.preventDefault(); if(!patrolBusy&&!patrolUnknown&&canOperate(user,'roomStatus'))setPatrolIssueRoom({ room: r, remark: '' }) }}
                      className={`rounded-lg border p-2 text-center transition-colors ${hasIssue ? 'border-red-300 bg-red-50' : latestPatrol ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-brand-400'}`}
                      title={hasIssue ? '当前异常，点击恢复正常' : latestPatrol ? '今日巡房正常（右键可报异常）' : '点击=正常；右键=报异常'}
                    >
                      <div className="font-semibold text-gray-800">{r.room_name || r.room_no}</div>
                      <div className="text-[10px] text-gray-400">{STATUS_STYLE[r.status]?.label || r.status}</div>
                      {hasIssue ? <div className="text-[10px] font-semibold text-red-600">⚠异常 · 点击恢复</div> : latestPatrol && <div className="text-[10px] text-emerald-600">✓正常</div>}
                    </button>
                  )
                })}
              </div>
              <div className="text-sm font-semibold text-gray-600 mb-2">今日巡房记录</div>
              <div className="max-h-40 overflow-y-auto">
                <table className="table w-full">
                  <thead><tr><th>时间</th><th>房间</th><th>结果</th><th>备注</th><th>巡房人</th></tr></thead>
                  <tbody>
                    {patrolRecords.map((p) => (
                      <tr key={p.id}>
                        <td className="text-xs">{p.created_at}</td>
                        <td className="font-medium">{p.room_name}</td>
                        <td>{p.status === 'issue' ? <span className="text-red-500 font-semibold">异常</span> : <span className="text-emerald-600">正常</span>}</td>
                        <td className="text-gray-500">{p.remark || '-'}</td>
                        <td>{p.user_name || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {patrolRecords.length === 0 && <div className="text-xs text-gray-400 text-center py-3">今日暂无巡房记录</div>}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">提示：点击房间标记「正常」，右键房间标记「异常」并填写备注。</div>
          </div>
        </DialogLayer>
      )}

      {/* 巡房异常弹窗 */}
      {patrolIssueRoom && (
        <DialogLayer title="巡房异常" onClose={() => {if(!patrolBusy&&!patrolUnknown)setPatrolIssueRoom(null)}}>
          <div className="bg-white rounded-lg shadow-2xl w-96 p-5" onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-lg font-bold mb-3">报异常：{patrolIssueRoom.room.room_name || patrolIssueRoom.room.room_no}</div>
            {patrolError&&<p role="alert" className="text-red-600">{patrolError}</p>}
            <label className="label">异常说明</label>
            <input className="input" disabled={patrolBusy||patrolUnknown} value={patrolIssueRoom.remark} onChange={(e) => setPatrolIssueRoom({ ...patrolIssueRoom, remark: e.target.value })} placeholder="如：空调不制冷 / 房间未打扫" autoFocus />
            <div className="flex gap-2 mt-4">
              <button className="btn-secondary flex-1" disabled={patrolBusy||patrolUnknown} onClick={() => setPatrolIssueRoom(null)}>取消</button>
              <button className="btn-primary flex-1" disabled={patrolBusy||!canOperate(user,'roomStatus')} onClick={async () => {
                const r = patrolIssueRoom.room
                const remark = patrolIssueRoom.remark
                await markPatrol(r, 'issue', remark)
              }}>{patrolUnknown?'核对原巡房结果':'确认报异常'}</button>
            </div>
          </div>
        </DialogLayer>
      )}
    </div>
  )
}
