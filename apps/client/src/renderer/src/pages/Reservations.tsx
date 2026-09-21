import {canOperate} from '../utils/permissions'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Reservation, Room, Technician } from '../types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { consumePrebookTech } from '../store/flow'
import { fmtDateTime,storeDateTime } from '../utils/format'
import { Modal, Confirm, Badge, EmptyState,AsyncButton } from '../components/ui'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import {getServerUrl} from '../api/transport'
import BookingWaitlist from '../components/BookingWaitlist'

const emptyForm = {
  id: undefined as number | undefined,
  version:undefined as number|undefined,
  duration:60,
  customer_name: '',
  customer_phone: '',
  room_id: '' as number | '',
  technician_id: '' as number | '',
  reserve_time: '',
  people: 1,
  remark: ''
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  offered:{label:'候补待确认',cls:'bg-violet-50 text-violet-600'},
  awaiting_payment:{label:'待支付订金',cls:'bg-amber-50 text-amber-600'},
  pending: { label: '待来店', cls: 'bg-amber-50 text-amber-600' },
  arrived: { label: '已到店', cls: 'bg-emerald-50 text-emerald-600' },
  cancelled: { label: '已取消', cls: 'bg-gray-100 text-gray-500' },
  completed:{label:'已完成',cls:'bg-gray-100 text-gray-600'}
}

export default function Reservations(): JSX.Element {
  const user = useAuth((s) => s.user)!
  const merchant=useAuth(s=>s.merchant),store=useAuth(s=>s.stores.find(row=>row.id===s.currentStoreId))
  const [list, setList] = useState<Reservation[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [techs, setTechs] = useState<Technician[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [filter, setFilter] = useState('pending')
  const [query, setQuery] = useState('')
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const saveBusy = useRef(false)
  const loadSequence = useRef(0)
  const [delTarget, setDelTarget] = useState<Reservation | null>(null)
  const visible = list.filter(r => !query.trim() || [r.customer_name, r.customer_phone, r.room_name, r.room_no, r.technician_name, r.remark].some(v => String(v || '').toLowerCase().includes(query.trim().toLowerCase())))

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    try {
      const rows = await api.listReservations(filter)
      if (sequence === loadSequence.current) { setList(rows); setLoadError('') }
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : '预约加载失败')
    }
  }, [filter])

  useEffect(() => {
    const loadBase = async (): Promise<void> => {
      const [r, t, u] = await Promise.all([api.listRooms(), api.listTechnicians(), api.reservationStaff()])
      setRooms(r)
      setTechs(t)
      setUsers(u)
      // 看板右键「预约该技师」预选联动：自动打开新增弹窗并选中该技师
      const pre = consumePrebookTech()
      if (pre) {
        if (t.some((x) => x.id === pre.id)) {
          setForm({ ...emptyForm, technician_id: pre.id, reserve_time: nowStr() })
          setShowForm(true)
          toast(`已预选技师 ${pre.name}，填好客户信息即可保存预约`)
        } else {
          toast(`技师「${pre.name}」不在当前门店，请先切换门店`, 'error')
        }
      }
    }
    loadBase().catch(() => setLoadError('房间、技师或员工资料加载失败，请重新进入预约页面'))
  }, [])

  useAutoRefresh(load)

  const save = async (): Promise<void> => {
    if (saveBusy.current) return
    if (!form.customer_name.trim()) {
      toast('请填写客户姓名', 'error')
      return
    }
    if (!form.reserve_time || !Number.isFinite(Date.parse(form.reserve_time.replace(' ', 'T'))) || !Number.isSafeInteger(form.people) || form.people < 1) {
      toast('请填写有效预约时间和正整数人数', 'error'); return
    }
    saveBusy.current = true; setSaving(true)
    try {
      const res = await api.saveReservation(
        { ...form, customer_name: form.customer_name.trim(), room_id: form.room_id || null, technician_id: form.technician_id || null }, user.id
      )
      if (!res.ok) { toast(res.msg || '保存失败', 'error'); return }
      toast('已保存'); setShowForm(false); await load()
    } catch { toast('保存结果未确认，输入已保留；请先核对预约列表再重试', 'error') }
    finally { saveBusy.current = false; setSaving(false) }
  }

  const setStatus = async (row: Reservation, status: string): Promise<void> => {
    try {
      const res = await api.setReservationStatus(row.id, status, user.id,row.version)
      if (!res.ok) toast(res.msg || '操作失败', 'error')
      await load()
    } catch { toast('操作结果未确认，请刷新核对预约状态', 'error') }
  }

  const nowStr = (): string => {
    return storeDateTime(new Date().toISOString()).slice(0,16)
  }

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-gray-800">预约登记</h2>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['pending', 'arrived', 'cancelled', 'all'] as const).map((f) => (
              <button key={f} className={`px-3 py-1 rounded-md text-xs ${filter === f ? 'bg-white shadow' : 'text-gray-500'}`} onClick={() => setFilter(f)}>
                {f === 'pending' ? '待来店' : f === 'arrived' ? '已到店' : f === 'cancelled' ? '已取消' : '全部'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2"><BookingWaitlist key={store?.id}/><AsyncButton className="btn-secondary" disabled={!merchant||!store} onClick={async()=>{await navigator.clipboard.writeText(new URL(`/customer/${encodeURIComponent(merchant!.code)}/${encodeURIComponent(store!.code)}/booking`,getServerUrl()||location.origin).href);toast('顾客预约入口已复制')}}>复制顾客预约入口</AsyncButton><button className="btn-primary" onClick={() => { setForm({ ...emptyForm, reserve_time: nowStr() }); setShowForm(true) }} disabled={!canOperate(user,'reservationManage')}>+ 新增预约</button></div>
      </header>

      <div className="flex-1 overflow-auto px-5 py-4">
        <div className="flex items-center gap-3 mb-3">
          <input className="input max-w-sm" aria-label="搜索预约" placeholder="客户 / 电话 / 房间 / 技师" value={query} onChange={e => setQuery(e.target.value)} />
          <span className="text-xs text-gray-500">{visible.length} 条预约</span>
          <button className="btn-secondary" onClick={load}>刷新</button>
        </div>
        {loadError && <p role="alert" className="text-red-600 mb-3">{loadError}；当前列表可能不是最新数据。</p>}
        <div className="card overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr><th>预约时间</th><th>客户</th><th>电话</th><th>房间</th><th>技师</th><th>人数</th><th>预订员工</th><th>状态</th><th>备注</th><th>操作</th></tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const st = STATUS_LABEL[r.status] || STATUS_LABEL.pending
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td>{fmtDateTime(r.reserve_time)}</td>
                    <td className="font-medium">{r.customer_name}</td>
                    <td>{r.customer_phone || '-'}</td>
                    <td>{r.room_name || r.room_no || '-'}</td>
                    <td>{r.technician_name || '-'}</td>
                    <td>{r.people}人</td>
                    <td>
                      <select
                        className="input !w-28 !py-1 text-xs"
                        value={r.staff_id ?? ''}
                        onChange={async (e) => {
                          const staffId = e.target.value ? Number(e.target.value) : null
                          const result = await api.setReservationStaff(r.id, staffId,r.version)
                          if (!result.ok) { toast(result.msg || '绑定失败', 'error'); return }
                          toast(staffId ? '已绑定预订员工（计入订房提成）' : '已取消员工绑定')
                          await load()
                        }}
                      >
                        <option value="">未绑定</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </td>
                    <td><Badge text={st.label} className={st.cls} /></td>
                    <td>{r.remark || '-'}</td>
                    <td>
                      <div className="flex gap-1.5">
                        {r.status === 'pending' && (
                          <>
                            <AsyncButton className="text-xs text-emerald-600 hover:underline" onClick={() => setStatus(r, 'arrived')} disabled={!canOperate(user,'reservationManage')}>到店</AsyncButton>
                            <AsyncButton className="text-xs text-gray-500 hover:underline" onClick={() => setStatus(r, 'cancelled')} disabled={!canOperate(user,'reservationManage')}>取消</AsyncButton>
                          </>
                        )}
                        {r.status === 'arrived' && !r.order_id && (
                          <>
                            <AsyncButton
                              className="text-xs text-brand-600 hover:underline"
                              onClick={async () => {
                                try {
                                  const res = await api.arriveAndOpen(r.id,r.version)
                                  if (res.ok !== false && res.id) toast(`已开房：${r.customer_name}（预约到店开房）`)
                                  else toast(res.msg || '开房失败（房间可能已占用，请直接点空闲房开房）', 'error')
                                } catch (e) {
                                  toast(e instanceof Error ? e.message : '开房失败', 'error')
                                }
                                await load()
                              }} disabled={!canOperate(user,'openOrder')}
                            >
                              开房
                            </AsyncButton>
                            <AsyncButton className="text-xs text-gray-500 hover:underline" onClick={() => setStatus(r, 'cancelled')} disabled={!canOperate(user,'reservationManage')}>取消</AsyncButton>
                          </>
                        )}
                        {r.order_id&&<span className="text-xs text-gray-500">订单 #{r.order_id}</span>}
                        {!r.order_id&&['pending','arrived'].includes(r.status)&&<button className="text-xs text-brand-600 hover:underline" onClick={() => { setForm({ id: r.id,version:r.version,duration:r.duration??60, customer_name: r.customer_name ?? '', customer_phone: r.customer_phone ?? '', room_id: r.room_id ?? '', technician_id: r.technician_id ?? '', reserve_time: storeDateTime(r.reserve_time).slice(0,16), people: r.people, remark: r.remark ?? '' }); setShowForm(true) }} disabled={!canOperate(user,'reservationManage')}>编辑</button>}
                        {r.status==='cancelled'&&<button className="text-xs text-red-500 hover:underline" onClick={() => setDelTarget(r)} disabled={!canOperate(user,'reservationManage')}>归档</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {visible.length === 0 && !loadError && <EmptyState text={query ? '没有匹配的预约' : '暂无预约'} />}
        </div>
      </div>

      <Modal
        open={showForm}
        title={form.id ? '编辑预约' : '新增预约'}
        onClose={() => { if (!saveBusy.current) setShowForm(false) }}
        footer={
          <>
            <button className="btn-secondary" disabled={saving} onClick={() => setShowForm(false)}>取消</button>
            <button className="btn-primary" disabled={(saving)||!canOperate(user,'reservationManage')} onClick={save}>{saving ? '保存中…' : '保存'}</button>
          </>
        }
      >
        <fieldset disabled={saving} className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">客户姓名 *</label>
            <input aria-label="预约客户姓名" className="input" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
          </div>
          <div>
            <label className="label">客户电话</label>
            <input className="input" value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} />
          </div>
          <div>
            <label className="label">预约时间</label>
            <input aria-label="预约时间" className="input" type="datetime-local" value={form.reserve_time?.replace(' ', 'T') || ''} onChange={(e) => setForm({ ...form, reserve_time: e.target.value.replace('T', ' ') })} />
          </div>
          <div>
            <label className="label">人数</label>
            <input className="input" type="number" min={1} value={form.people} onChange={(e) => setForm({ ...form, people: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">预约房间</label>
            <select aria-label="预约房间" className="input" value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">不限</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.room_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">预约技师</label>
            <select className="input" value={form.technician_id} onChange={(e) => setForm({ ...form, technician_id: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">不限</option>
              {techs.map((t) => <option key={t.id} value={t.id}>{t.code}号 {t.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">预计时长（分钟）</label>
            <input aria-label="预约时长" type="number" min={1} max={1440} className="input" value={form.duration} onChange={e=>setForm({...form,duration:Number(e.target.value)})}/>
          </div>
          <div className="col-span-2">
            <label className="label">备注</label>
            <input className="input" value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </div>
        </fieldset>
      </Modal>
      <Confirm open={!!delTarget} title="归档预约" message={`确认归档「${delTarget?.customer_name}」的已取消预约？历史记录会保留。`} danger onCancel={() => setDelTarget(null)} onConfirm={async () => {
        if (!delTarget) return
        try {
          const res = await api.deleteReservation(delTarget.id, user.id,delTarget.version)
          if (!res.ok) { toast(res.msg || '删除失败', 'error'); return }
          setDelTarget(null); await load()
        } catch { toast('删除结果未确认，请刷新核对', 'error') }
      }} />
    </div>
  )
}
