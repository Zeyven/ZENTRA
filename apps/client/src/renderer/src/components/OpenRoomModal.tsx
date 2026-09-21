import {canOperate} from '../utils/permissions'
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Member, Order, Room, Technician, Wristband } from '../types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { AsyncButton, Modal } from './ui'
import { CARD_TYPES } from '../utils/format'

export default function OpenRoomModal(props: {
  roomId: number | null
  onClose: () => void
  onDone: (orderId?: number, order?: Order) => void
}): JSX.Element | null {
  const user = useAuth((s) => s.user)!
  const [rooms, setRooms] = useState<Room[]>([])
  const [wristbands, setWristbands] = useState<Wristband[]>([])
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loadedRoomId, setLoadedRoomId] = useState<number | null>(null)
  const ready = props.roomId !== null && loadedRoomId === props.roomId

  const [roomId, setRoomId] = useState<number | null>(props.roomId)
  const [wristband, setWristband] = useState('')
  const [deposit, setDeposit] = useState(0)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [technicianId, setTechnicianId] = useState<number | ''>('')
  const [memberId, setMemberId] = useState<number | ''>('')

  useEffect(() => {
    if (!props.roomId) return
    let disposed = false
    setLoadedRoomId(null)
    setRoomId(props.roomId)
    const load = async (): Promise<void> => {
      const [r, w, t] = await Promise.all([api.listRooms(), api.listWristbands(), api.listTechnicians()])
      if (disposed) return
      setRooms(r.filter((x) => x.status === 'idle'))
      setWristbands(w.filter((x) => x.status === 'idle'))
      setWristband(''); setDeposit(0)
      setTechnicians(t.filter((x) => x.status !== 'off' && x.status !== 'serving'))
      setLoadedRoomId(props.roomId)
    }
    load().catch(() => { if (!disposed) toast('开房资料加载失败，请关闭后重试', 'error') })
    return () => { disposed = true }
  }, [props.roomId])

  // 选手牌时自动带出该手牌的标准押金
  const onPickWristband = (code: string): void => {
    setWristband(code)
    const w = wristbands.find((x) => x.code === code)
    setDeposit(Number(w?.deposit || 0))
  }

  const searchMembers = async (kw: string): Promise<void> => {
    if (kw.trim().length >= 1) setMembers(await api.searchCashierMembers(kw))
  }

  const submit = async (): Promise<void> => {
    if (!ready) return
    if (!roomId) {
      toast('请选择房间', 'error')
      return
    }
    const res = await api.openOrder(
      {
        room_id: roomId,
        wristband_no: wristband || null,
        deposit: wristband ? Number(deposit) || 0 : 0,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        technician_id: technicianId || null,
        member_id: memberId || null,
        source: 'room'
      },
      user.id
    )
    if (res.ok) {
      toast(`开房成功 ${res.order_no || ''}`)
      props.onDone(res.order_id, res.order)
    } else toast(res.msg || '开房失败', 'error')
  }

  return (
    <Modal
      open={props.roomId !== null}
      title="开房"
      onClose={props.onClose}
      width="max-w-xl"
      footer={
        <>
          <button className="btn-secondary" onClick={props.onClose}>
            取消
          </button>
          <AsyncButton className="btn-primary" disabled={(!ready)||!canOperate(user,'openOrder')} onClick={submit}>
            确认开房
          </AsyncButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">房间 *</label>
          <select aria-label="开房房间" disabled={!ready} className="input" value={roomId ?? ''} onChange={(e) => { setRoomId(Number(e.target.value)); setWristband(''); setDeposit(0) }}>
            <option value="">{ready?'请选择房间':'正在读取房间…'}</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.room_name}（{r.room_type}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">手牌</label>
          <select aria-label="开房手牌" className="input" value={wristband} onChange={(e) => onPickWristband(e.target.value)}>
            <option value="">不绑手牌</option>
            {wristbands.filter(w => w.room_id == null || w.room_id === roomId).map((w) => (
              <option key={w.id} value={w.code}>
                {w.code}{w.room_id != null ? '（本房固定手牌）' : '（未配置固定房间）'}
              </option>
            ))}
          </select>
          {ready && wristbands.length === 0 && (
            <div className="text-xs text-amber-600 mt-1">
              ⚠️ 暂无空闲手牌——请先到「系统设置 → 手牌管理」批量添加手牌编码，或所有手牌均在使用中
            </div>
          )}
        </div>
        {wristband && (
          <div>
            <label className="label">手牌押金（元）</label>
            <input aria-label="手牌押金" className="input" type="number" min={0} step={1} value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} placeholder="0" />
            <div className="text-xs text-gray-400 mt-1">收取后记入订单，退牌时退还并核销</div>
          </div>
        )}
        <div>
          <label className="label">客户姓名</label>
          <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="选填" />
        </div>
        <div>
          <label className="label">客户电话</label>
          <input className="input" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="选填" />
        </div>
        <div>
          <label className="label">点钟技师</label>
          <select className="input" value={technicianId} onChange={(e) => setTechnicianId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">到店再排钟</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}号 {t.name}（{t.level}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">关联会员</label>
          <input className="input" onChange={(e) => searchMembers(e.target.value)} placeholder="输入姓名/手机号/卡号搜索" />
        </div>
      </div>
      {members.length > 0 && (
        <div className="mt-3 space-y-1 max-h-32 overflow-y-auto">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => setMemberId(m.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm border ${
                memberId === m.id ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="font-medium">{m.name}</span>
              <span className="text-gray-500">
                {m.card_no || '-'} · {CARD_TYPES[m.card_type]} · 余额¥{m.balance.toFixed(0)}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
