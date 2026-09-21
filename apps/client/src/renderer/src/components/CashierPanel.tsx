import {canOperate} from '../utils/permissions'
import {DialogLayer} from './ui'
import {BRAND_NAME} from '../../../shared/brand'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import type { Category, Item, Member, Order, Technician } from '../types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { fmtMoney, fmtNum, fmtDateTime, elapsedMinutes, fmtDuration, CARD_TYPES, TECH_LEVELS, sortTechnicians, computeDiscount } from '../utils/format'
import { can } from '../utils/permissions'
import { uuid } from '../utils/uuid'
import { AsyncButton, Modal, Confirm, Badge } from './ui'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import './cashier.css'
const ClockTerminal = lazy(() => import('../pages/ClockTerminal'))

interface Settings {
  discount_schemes?: string
  pay_methods?: string
  store_name?: string
  store_address?: string
  store_phone?: string
  // 收款码图片（base64，系统设置→支付方式上传；收银台"出示收款码"用）
  [k: string]: string | undefined
}

interface PaymentMethod {
  code: string
  name: string
}

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  { code: '现金', name: '现金' },
  { code: '微信', name: '微信' },
  { code: '支付宝', name: '支付宝' },
  { code: '银行卡', name: '银行卡' },
  { code: '美团', name: '美团' },
  { code: '抖音', name: '抖音' },
  { code: '会员卡', name: '会员卡' }
]

export default function CashierPanel(props: { orderId: number; initialOrder?: Order; onClose: () => void; inline?: boolean }): JSX.Element {
  const user = useAuth((s) => s.user)!
  const [order, setOrder] = useState<Order | null>(() => props.initialOrder?.id === props.orderId ? props.initialOrder : null)
  const [orderError, setOrderError] = useState('')
  const [orderLoading, setOrderLoading] = useState(false)
  const [baseError, setBaseError] = useState('')
  const [baseLoaded, setBaseLoaded] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [techs, setTechs] = useState<Technician[]>([])
  const [settings, setSettings] = useState<Settings>({})
  const [tab, setTab] = useState<'service' | 'product'>('service')
  const [catId, setCatId] = useState<number | ''>('')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({})
  const [voucherCodes, setVoucherCodes] = useState<Record<string, string>>({})
  const [settling, setSettling] = useState(false)
  const settlementRunning=useRef(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [showClockTerminal, setShowClockTerminal] = useState(false)
  const [tick, setTick] = useState(0)
  const checkoutKeyRef = useRef(`checkout-${props.orderId}-${uuid()}`)

  // 加项目弹窗
  const [addTarget, setAddTarget] = useState<Item | null>(null)
  const [addTechId, setAddTechId] = useState<number | ''>('')
  const [addServiceType, setAddServiceType] = useState('轮钟')
  const [addQty, setAddQty] = useState(1)
  const [techTarget, setTechTarget] = useState<any | null>(null)
  const [changeTechId, setChangeTechId] = useState<number | ''>('')

  // 折扣弹窗
  const [showDiscount, setShowDiscount] = useState(false)
  const [discType, setDiscType] = useState<'scheme' | 'rate' | 'amount' | 'round' | 'free'>('rate')
  const [discValue, setDiscValue] = useState('88')
  const [discAmount, setDiscAmount] = useState('')

  // 会员搜索
  const [memberKw, setMemberKw] = useState('')
  const [memberResults, setMemberResults] = useState<Member[]>([])

  // 换房弹窗
  const [showChangeRoom, setShowChangeRoom] = useState(false)
  const [changeRoomId, setChangeRoomId] = useState<number | ''>('')
  const [idleRooms, setIdleRooms] = useState<{ id: number; room_name: string }[]>([])

  // 联房弹窗
  const [showLink, setShowLink] = useState(false)
  const [linkableOrders, setLinkableOrders] = useState<Order[]>([])
  const [groupOrders, setGroupOrders] = useState<{ id: number; order_no: string; room_name?: string; room_no?: string; status: string; subtotal: number; payable: number }[]>([])

  // 优惠券
  const [showCoupon, setShowCoupon] = useState(false)
  const [coupons, setCoupons] = useState<any[]>([])

  const [confirmAction, setConfirmAction] = useState<{ title: string; msg: string; fn: () => void } | null>(null)
  // 出示收款码（试营业人工核销：顾客扫码付款 → 确认到账后点结账）
  const [qrShow, setQrShow] = useState<PaymentMethod | null>(null)
  const [settlementDetails, setSettlementDetails] = useState<Order | null>(null)

  const mounted = useRef(true)
  const latestOrder = useRef<Order | null>(order)
  const orderReadSequence = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const applyOrder = useCallback((next: Order) => {
    if (!mounted.current || next.id !== props.orderId) return
    // A delayed background read must not undo a newer committed mutation.
    if (latestOrder.current?.id === next.id && Number(latestOrder.current.version || 0) > Number(next.version || 0)) return
    latestOrder.current = next
    setOrder(next)
    setOrderError('')
    setSettlementDetails(previous => previous && (next.status === 'closed' || next.status === 'cancelled') ? next : null)
  }, [props.orderId])

  const commitOrder = useCallback((next: Order) => {
    // Invalidate every detail read that started before this acknowledged write.
    // Its HTTP response can still arrive later, but it may no longer update UI.
    orderReadSequence.current += 1
    setOrderLoading(false)
    applyOrder(next)
  }, [applyOrder])

  const loadOrder = useCallback(async () => {
    const sequence = ++orderReadSequence.current
    setOrderLoading(true)
    try {
      const o = await api.getOrder(props.orderId)
      if (mounted.current && sequence === orderReadSequence.current) applyOrder(o)
    } catch (error) {
      if (mounted.current && sequence === orderReadSequence.current) {
        setOrderError(error instanceof Error ? error.message : '订单读取失败，请重试')
      }
    } finally {
      if (mounted.current && sequence === orderReadSequence.current) setOrderLoading(false)
    }
  }, [props.orderId, applyOrder])

  const loadBase = useCallback(async () => {
    try {
      const [it, c, t, s] = await Promise.all([api.listItems(), api.listCategories(), api.listTechnicians(), api.getCashierSettings()])
      if (!mounted.current) return
      setItems(it); setCats(c); setTechs(t); setSettings(s); setBaseError(''); setBaseLoaded(true)
    } catch {
      if (mounted.current) setBaseError('项目、技师或收款配置读取失败，请重试')
    }
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([loadOrder(), loadBase()])
  }, [loadOrder, loadBase])
  // App owns the single socket and recovery loop for this window.
  useAutoRefresh(refresh)

  // 收银单已进行时长每 5 秒重绘；无需等待服务端产生新事件。
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const serviceItems = useMemo(() => items.filter((i) => i.type === 'service'), [items])
  const productItems = useMemo(() => items.filter((i) => i.type === 'product'), [items])
  const shownItems = useMemo(() => {
    const list = tab === 'service' ? serviceItems : productItems
    const query = catalogQuery.trim().toLocaleLowerCase()
    return list.filter((i) => (!catId || i.category_id === catId) && (!query || i.name.toLocaleLowerCase().includes(query)))
  }, [tab, serviceItems, productItems, catId, catalogQuery])

  const paymentMethods = useMemo((): PaymentMethod[] => {
    try {
      const configured = JSON.parse(settings.pay_methods || '[]')
      if (!Array.isArray(configured) || configured.length === 0) return DEFAULT_PAYMENT_METHODS
      return configured.map((method: string | PaymentMethod) => typeof method === 'string' ? { code: method, name: method } : method)
    } catch {
      return DEFAULT_PAYMENT_METHODS
    }
  }, [settings.pay_methods])

  if (!order) {
    return (
      <div className={props.inline ? 'h-full flex flex-col bg-white' : 'fixed inset-0 z-[4000] bg-white flex flex-col'}>
        <header className="h-14 px-5 flex items-center gap-3 border-b border-gray-200 shrink-0">
          <button aria-label="返回房态或账单" className="btn-secondary" onClick={props.onClose}>返回</button>
          <h2 className="font-semibold">收银台 · 订单 #{props.orderId}</h2>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-5">
          {orderError ? <p role="alert" className="text-red-600">{orderError}</p> : <p role="status">正在读取订单…</p>}
          {orderError && <AsyncButton className="btn-primary" disabled={orderLoading} onClick={loadOrder}>重试加载订单</AsyncButton>}
        </div>
      </div>
    )
  }

  const payable = order.payable
  const unpaid = payable - order.paid
  const blockedClocks = (order.items || []).filter(item => item.item_type === 'service' && !item.is_refund && (!item.clock_in_at || item.clock_paused_at))

  const reload = async (res?: { ok?: boolean; msg?: string; order?: Order }): Promise<void> => {
    if (res?.ok === false) { toast(res.msg || '操作失败', 'error'); return }
    if (res?.order) commitOrder(res.order)
    else await loadOrder()
  }

  // —— 加项目 ——
  const openAdd = (item: Item): void => {
    setAddTarget(item)
    setAddTechId('')
    setAddServiceType('轮钟')
    setAddQty(1)
  }

  const confirmAdd = async (): Promise<void> => {
    if (!addTarget) return
    const res = await api.addItems(
      {
        order_id: order.id, version: order.version,
        items: [
          {
            item_id: addTarget.id,
            quantity: addQty,
            technician_id: addTarget.type === 'service' ? addTechId || null : null,
            service_type: addTarget.type === 'service' ? addServiceType : undefined
          }
        ]
      },
      user.id
    )
    if (res.ok) {
      toast(`已添加 ${addTarget.name}`)
      setAddTarget(null)
      await reload(res)
    } else {
      toast(res.msg || '添加失败', 'error')
    }
  }

  // —— 折扣 ——
  const openDiscount = (): void => {
    setDiscType('rate')
    setDiscValue('88')
    setDiscAmount('')
    setShowDiscount(true)
  }

  const applyDiscount = async (): Promise<void> => {
    // 折扣金额统一由 computeDiscount 计算并校验：空值/非数字/超范围一律抛错拦截。
    // 历史缺陷：Number('') === 0，整单折扣留空会被当成 0 折 → 静默全额减免。
    let computed: { discount: number; detail: string }
    try {
      computed = computeDiscount({
        discType,
        discValue,
        discAmount,
        subtotal: order.subtotal
      })
    } catch (error) {
      toast(error instanceof Error ? error.message : '折扣输入无效，请核对后重试', 'error')
      return
    }
    const res = await api.applyDiscount(
      { order_id: order.id, version: order.version, discount: computed.discount, detail: computed.detail },
      user.id
    )
    if (res.ok) {
      toast('折扣已应用')
      setShowDiscount(false)
      await reload(res)
    } else toast(res.msg || '折扣未应用', 'error')
  }

  // —— 结账 ——
  // 汇总各支付方式金额为 payments 数组；method 必须用中文名（现金/微信/支付宝/银行卡/美团/抖音/会员卡），
  // 与中心后端 /leisure/sessions/:id/checkout 契约一致；团购方式携带 voucher_code 用于核销记录
  const collectPayments = (): { method: string; amount: number; voucher_code?: string | null }[] => {
    const list: { method: string; amount: number; voucher_code?: string | null }[] = []
    for (const [k, v] of Object.entries(payAmounts)) {
      const amt = Number(v)
      if (amt > 0) {
        const m = paymentMethods.find((x) => x.code === k)
        list.push({
          method: m?.name || k,
          amount: Math.round(amt * 100) / 100,
          ...(voucherCodes[k]?.trim()?{voucher_code:voucherCodes[k].trim()}:{})
        })
      }
    }
    return list
  }

  const settle = async (): Promise<void> => {
    if (settlementRunning.current || orderError || baseError) return
    setCheckoutError('')
    const pays = collectPayments()
    const total = pays.reduce((s, p) => s + p.amount, 0)
    if (Math.abs(total - unpaid) > 0.009) {
      setCheckoutError(`收款金额应为 ¥${unpaid.toFixed(2)}，当前 ¥${total.toFixed(2)}`)
      toast(`收款金额应为 ¥${unpaid.toFixed(2)}，当前 ¥${total.toFixed(2)}`, 'error')
      return
    }
    settlementRunning.current=true;setSettling(true)
    try {
      const res = await api.settle({ order_id: order.id, version: order.version, payments: pays, member_id: order.member_id, idempotency_key: checkoutKeyRef.current }, user.id)
      if (res.ok) {
        toast('结账成功')
        setPayAmounts({})
        setVoucherCodes({})
        await reload(res)
        if (res.order) setSettlementDetails(res.order)
      } else {
        setCheckoutError(res.msg || '结账失败')
        toast(res.msg || '结账失败', 'error')
      }
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : '结账失败')
      toast(error instanceof Error ? error.message : '结账失败', 'error')
    } finally {
      settlementRunning.current=false;setSettling(false)
    }
  }

  const doItemAction = (fn: () => Promise<void>, confirmTitle: string, confirmMsg: string): void => {
    setConfirmAction({ title: confirmTitle, msg: confirmMsg, fn })
  }

  // 挂单（暂存订单，释放房间与技师）
  const suspendOrder = async (): Promise<void> => {
    const res = await api.suspendOrder(order.id, user.id, order.version)
    if (res.ok) {
      toast('已挂单，订单可在账单管理恢复')
      commitOrder(res.order || (await api.getOrder(order.id)))
      props.onClose()
    } else {
      toast(res.msg || '挂单失败', 'error')
    }
  }

  const refund = async (itemId: number): Promise<void> => {
    const res = await api.refundItem({ order_id: order.id, version: order.version, item_id: itemId }, user.id)
    if (res.ok) await reload(res)
    else toast(res.msg || '操作失败', 'error')
  }
  const gift = async (itemId: number): Promise<void> => {
    const res = await api.giftItem({ order_id: order.id, version: order.version, item_id: itemId }, user.id)
    if (res.ok) await reload(res)
    else toast(res.msg || '赠单失败', 'error')
  }
  const changePrice = async (itemId: number, price: number): Promise<void> => {
    const res = await api.changePrice({ order_id: order.id, version: order.version, item_id: itemId, price }, user.id)
    if (res.ok) await reload(res)
    else toast(res.msg || '改价失败', 'error')
  }
  const addTime = async (itemId: number, minutes: number): Promise<void> => {
    const res = await api.addTime({ order_id: order.id, version: order.version, item_id: itemId, minutes }, user.id)
    if (res.ok) await reload(res)
    else toast(res.msg || '操作失败', 'error')
  }
  const changeTech = async (itemId: number, techId: number | null, stype?: string): Promise<boolean> => {
    try {
      const res = await api.changeTechnician({ order_id: order.id, version: order.version, item_id: itemId, technician_id: techId, service_type: stype }, user.id)
      if (res.ok) {
        await reload(res)
        return true
      }
      toast(res.msg || '派钟失败', 'error')
    } catch (error) {
      toast(error instanceof Error ? error.message : '派钟失败，请检查网络和技师状态', 'error')
    }
    return false
  }
  const endService = async (itemId: number): Promise<void> => {
    const res = await api.endService({ order_id: order.id, version: order.version, item_id: itemId }, user.id)
    if (res.ok) {
      await reload(res)
    } else {
      setCheckoutError(res.msg || '落钟失败')
      toast(res.msg || '落钟失败', 'error')
    }
  }

  const searchMembers = async (kw: string): Promise<void> => {
    setMemberKw(kw)
    if (kw.trim()) setMemberResults(await api.searchCashierMembers(kw))
    else setMemberResults([])
  }

  const bindMember = async (m: Member): Promise<void> => {
    const res = await api.bindMember({ order_id: order.id, version: order.version, member_id: m.id, customer_name: m.name, customer_phone: m.phone }, user.id)
    if (res.ok) {
      toast('会员已绑定')
      setMemberResults([])
      setMemberKw('')
      await reload(res)
    } else toast(res.msg || '会员绑定失败', 'error')
  }

  const doChangeRoom = async (): Promise<void> => {
    if (!changeRoomId) return
    const res = await api.changeRoom({ order_id: order.id, version: order.version, room_id: changeRoomId }, user.id)
    if (res.ok) {
      toast('转房成功')
      setShowChangeRoom(false)
      await reload(res)
    }
  }

  const openChangeRoom = async (): Promise<void> => {
    const rooms = await api.listRooms()
    setIdleRooms(rooms.filter((r) => r.status === 'idle'))
    setChangeRoomId('')
    setShowChangeRoom(true)
  }

  const openLink = async (): Promise<void> => {
    const all = await api.listOrders('open')
    setLinkableOrders(all.filter((o) => o.id !== order.id))
    setGroupOrders((await api.listOrderGroup(order.id)).filter(row => row.id !== order.id))
    setShowLink(true)
  }

  const doLink = async (targetId: number): Promise<void> => {
    const res = await api.linkOrder({ order_id: order.id, target_order_id: targetId }, user.id)
    if (res.ok) {
      toast('联房成功')
      setGroupOrders((await api.listOrderGroup(order.id)).filter(row => row.id !== order.id))
    } else {
      toast(res.msg || '联房失败', 'error')
    }
  }

  const doUnlink = async (orderId: number): Promise<void> => {
    const res = await api.unlinkOrder(orderId, user.id)
    if (!res.ok) { toast(res.msg || '解除联房失败', 'error'); return }
    toast('已解除联房')
    setGroupOrders((await api.listOrderGroup(order.id)).filter(row => row.id !== order.id))
  }

  const openCoupon = async (): Promise<void> => {
    if (!order.member_id) {
      toast('请先绑定会员', 'error')
      return
    }
    setCoupons(await api.listCoupons({ member_id: order.member_id, status: 'unused' }))
    setShowCoupon(true)
  }

  const useCoupon = async (couponId: number): Promise<void> => {
    const res = await api.useCoupon({ order_id: order.id, version: order.version, coupon_id: couponId }, user.id)
    if (res.ok) {
      toast(`已用券，抵扣 ¥${res.discount}`)
      setShowCoupon(false)
      await reload(res.order ? { order: res.order } : undefined)
    } else {
      toast(res.msg || '用券失败', 'error')
    }
  }

  const openItems = order.items || []
  const activeItems = openItems.filter((i) => i.status === 'active')
  // 已落钟项目仍属于当前待结账消费单，不能从“已点项目”数量中消失。
  const countedItems = openItems.filter((i) => !i.is_refund)
  const unassignedServiceItems = activeItems.filter((i) => i.item_type === 'service' && !i.technician_id)
  const elapsed = elapsedMinutes(order.opened_at)

  const availableTechs = sortTechnicians(techs.filter((t) => t.status !== 'serving'))

  return (
    <div className={`cashier-shell ${props.inline ? 'h-full flex flex-col bg-white overflow-hidden' : 'fixed inset-0 z-[4000] bg-black/30 flex'}`}>
      {/* 主区 */}
      <div className={`flex-1 bg-white flex flex-col overflow-hidden ${props.inline ? '' : 'ml-auto mr-auto w-full max-w-[1400px]'}`}>
        {(orderError || baseError) && <div role="alert" className="p-3 bg-amber-50 text-amber-900 text-sm shrink-0">
          {orderError || baseError}。当前保留上次已确认的数据。
          <AsyncButton className="btn-secondary ml-2" onClick={refresh}>重试加载订单</AsyncButton>
        </div>}
        {/* 头部 */}
        <header className="h-14 px-5 flex items-center justify-between border-b border-gray-200 bg-white shrink-0">
          <div className="flex items-center gap-4">
            <button aria-label="返回房态或账单" className="btn-ghost text-xl" onClick={props.onClose}>
              ←
            </button>
            <div>
              <div className="text-base font-bold text-gray-800">
                收银单 {order.order_no}
                {order.status !== 'open' && (
                  <span className="ml-2 text-xs text-gray-400">
                    ({order.status === 'closed' ? '已结账' : order.status === 'suspended' ? '已挂单' : '已取消'})
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500">
                {order.room?.room_name || order.room_no || '无房间'}
                {order.wristband_no && ` · 手牌 ${order.wristband_no}`}
                {order.customer_name && ` · ${order.customer_name}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {order.status === 'closed' && <button className="btn-secondary" disabled={!!orderError || orderLoading} onClick={() => setSettlementDetails(order)}>结账明细 / 打印</button>}
            <Badge text={`已进行 ${fmtDuration(elapsed)}`} className="bg-amber-50 text-amber-600" />
            <span className="text-gray-500">
              应收 <b className="text-lg text-gray-800">{fmtMoney(order.payable)}</b>
            </span>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* 左：已点项目 */}
          <div className="cashier-lines flex-1 flex flex-col border-r border-gray-200 min-h-0 min-w-0">
            <div className="h-10 px-4 flex items-center justify-between border-b border-gray-100 text-sm font-medium text-gray-600">
              <span>已点项目（{countedItems.length}）</span>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={() => doItemAction(async () => { if (order.status === 'open') props.onClose() }, '提示', '确认关闭当前收银单？')}>
                  关闭
                </button>
              </div>
            </div>
            {unassignedServiceItems.length > 0 && (
              <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 flex items-center justify-between gap-3">
                <div className="text-xs text-amber-800">⚠ 有 {unassignedServiceItems.length} 个服务未派钟，须先派技师才能结账和计算提成。</div>
                <button className="shrink-0 text-xs font-medium text-amber-900 underline" onClick={() => { const item = unassignedServiceItems[0]; setTechTarget(item); setChangeTechId('') }} disabled={!canOperate(user,'assignTechnician')}>立即派钟</button>
              </div>
            )}
            <div className="flex-1 overflow-auto min-h-0">
              <table className="cashier-items-table table w-full">
                <caption className="sr-only">已点项目明细，含技师、数量、单价、金额与操作</caption>
                <thead>
                  <tr>
                    <th>项目</th>
                    <th>类型</th>
                    <th>技师</th>
                    <th>数量</th>
                    <th>单价</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {openItems.map((it) => (
                    <tr key={it.id} className={it.is_gift ? 'opacity-50' : ''}>
                      <td data-label="项目" className="cashier-item-name">
                        <div className="font-medium">{it.item_name}</div>
                        {it.duration > 0 && <div className="text-xs text-gray-400">{it.duration}分钟</div>}
                      </td>
                      <td data-label="类型">{it.item_type === 'service' ? (it.service_type || '服务') : '商品'}</td>
                      <td data-label="技师">{it.technician_name ? `${it.technician_code ? `${it.technician_code}号 ` : ''}${it.technician_name}` : (it.item_type === 'service' ? '未派钟' : '不适用')}</td>
                      <td data-label="数量">{it.quantity}</td>
                      <td data-label="单价">{fmtNum(it.price)}</td>
                      <td data-label="金额" className="font-semibold">{fmtNum(it.amount)}</td>
                      <td data-label="状态">
                        {it.is_gift ? <Badge text="赠" className="bg-pink-50 text-pink-600" /> : it.is_refund ? <Badge text="退" className="bg-red-50 text-red-500" /> : it.status === 'active' ? <Badge text={it.item_type === 'service' && !it.clock_in_at ? '待报钟' : it.clock_paused_at ? '已暂停' : '进行中'} className="bg-emerald-50 text-emerald-600" /> : it.status === 'done' ? <Badge text="已落钟" className="bg-gray-100 text-gray-500" /> : <Badge text={it.status} className="bg-gray-100 text-gray-500" />}
                      </td>
                      <td data-label="操作" className="cashier-item-actions">
                        {order.status === 'open' && !it.is_gift && !it.is_refund && (
                          <div className="flex gap-1 flex-wrap">
                            {it.item_type === 'service' && (
                              <>
                                <button className="text-xs text-brand-600 hover:underline" onClick={() => doItemAction(() => addTime(it.id, 30), '加钟', `为「${it.item_name}」加钟30分钟？`)} disabled={!canOperate(user,'addTime')}>
                                  加钟
                                </button>
                                {!it.clock_out_at && (
                                  <button className="text-xs text-sky-600 hover:underline" onClick={() => doItemAction(() => endService(it.id), '落钟', `确认「${it.item_name}」落钟？`)} disabled={!canOperate(user,'finishService')}>
                                    落钟
                                  </button>
                                )}
                                <button className="text-xs text-gray-500 hover:underline" onClick={() => { setTechTarget(it); setChangeTechId(it.technician_id || '') }} disabled={!canOperate(user,'assignTechnician')}>
                                  {it.technician_id ? '换技师' : '派技师'}
                                </button>
                              </>
                            )}
                            {can(user, 'gift') && (
                              <button className="text-xs text-gray-500 hover:underline" onClick={() => doItemAction(() => gift(it.id), '赠单', `将「${it.item_name}」改为赠单？`)}>
                                赠单
                              </button>
                            )}
                            {can(user, 'refund') && (
                              <button className="text-xs text-gray-500 hover:underline" onClick={() => doItemAction(() => refund(it.id), '退单', `退掉「${it.item_name}」？`)}>
                                退单
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {openItems.length === 0 && (
                    <tr>
                      <td colSpan={8} className="cashier-items-empty text-center text-gray-400 py-8">
                        暂无项目，请在右侧选择添加
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 右：点单 + 结账 */}
          <div data-testid="cashier-payment-panel" className={`${props.inline ? 'w-[300px]' : 'w-[360px]'} shrink-0 flex flex-col min-h-0`}>
            {/* 点单 */}
            <div className="flex-1 flex flex-col overflow-hidden border-b border-gray-200">
              <div className="flex border-b border-gray-100">
                {(['service', 'product'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTab(t)
                      setCatId('')
                      setCatalogQuery('')
                    }}
                    className={`flex-1 py-2.5 text-sm font-medium ${tab === t ? 'text-brand-700 border-b-2 border-brand-600' : 'text-gray-500'}`}
                  >
                    {t === 'service' ? '服务项目' : '商品酒水'}
                  </button>
                ))}
              </div>
              <div className="px-3 py-2 flex gap-2 overflow-x-auto">
                <button className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${!catId ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`} onClick={() => setCatId('')}>
                  全部
                </button>
                {cats
                  .filter((c) => c.type === tab)
                  .map((c) => (
                    <button
                      key={c.id}
                      className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${catId === c.id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                      onClick={() => setCatId(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
              </div>
              <div className="px-3 pb-2"><input className="input" aria-label="搜索服务或商品" placeholder="搜索服务 / 商品名称" value={catalogQuery} onChange={e => setCatalogQuery(e.target.value)} /></div>
              <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-3">
                {!baseLoaded&&!baseError&&<p role="status" className="cashier-catalog-empty">正在读取项目与收款配置…</p>}
                {baseLoaded&&shownItems.length === 0 && <div className="cashier-catalog-empty"><p>没有匹配的项目</p><button className="btn-ghost" onClick={() => { setCatalogQuery(''); setCatId('') }}>清除项目筛选</button></div>}
                <div className="grid grid-cols-2 gap-2">
                  {shownItems.map((it) => (
                    <button
                      key={it.id}
                      aria-label={`添加${it.type === 'service' ? '服务' : '商品'} ${it.name}`}
                      disabled={(!!it.sold_out)||!canOperate(user,'orderEdit')}
                      onClick={() => (tab === 'service' ? openAdd(it) : confirmQuickAdd(it))}
                      className={`text-left rounded-lg border border-gray-200 p-2.5 transition-colors ${it.sold_out ? 'opacity-45 cursor-not-allowed bg-gray-50' : 'hover:border-brand-400 hover:bg-brand-50'}`}
                    >
                      <div className="text-sm font-medium text-gray-800 break-words">{it.name}</div>
                      {it.duration > 0 && <div className="text-[10px] text-gray-400">{it.duration}分钟</div>}
                      <div className="text-brand-600 font-semibold text-sm mt-1">{fmtMoney(it.price)}</div>
                      {!!it.sold_out && <div className="text-[10px] text-red-500">已售罄</div>}
                      {it.type === 'product' && it.stock >= 0 && it.stock <= 10 && !it.sold_out && <div className="text-[10px] text-red-500">库存{it.stock}</div>}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 结账区：内容区可滚动，底部操作条固定不遮挡 */}
            <div className="max-h-[62%] min-h-0 flex flex-col bg-gray-50">
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {/* 会员 */}
              <div>
                <div className="text-xs text-gray-500 mb-1">关联会员</div>
                {order.member ? (
                  <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{order.member.name}</div>
                      <div className="text-xs text-gray-400">
                        {CARD_TYPES[order.member.card_type]} · 余额¥{order.member.balance.toFixed(0)}
                        {order.member.times_balance > 0 ? ` · 次卡${order.member.times_balance}次` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <AsyncButton className="text-xs text-violet-600 hover:text-violet-700" onClick={openCoupon} disabled={!canOperate(user,'orderEdit')}>
                        🎟 优惠券
                      </AsyncButton>
                      <AsyncButton className="text-xs text-gray-400 hover:text-red-500" onClick={() => api.bindMember({ order_id: order.id, version: order.version, member_id: null }, user.id).then(reload)} disabled={!canOperate(user,'orderEdit')}>
                        解绑
                      </AsyncButton>
                    </div>
                  </div>
                ) : (
                  <input className="input" value={memberKw} onChange={(e) => searchMembers(e.target.value)} placeholder="输入姓名/手机号/卡号搜索会员" />
                )}
                {memberResults.length > 0 && (
                  <div className="mt-1 space-y-1 max-h-28 overflow-y-auto">
                    {memberResults.map((m) => (
                      <AsyncButton key={m.id} className="w-full text-left px-3 py-2 rounded bg-white border border-gray-200 text-sm hover:bg-gray-50" onClick={() => bindMember(m)} disabled={!canOperate(user,'orderEdit')}>
                        <span className="font-medium">{m.name}</span>
                        <span className="text-gray-400 ml-2">{m.card_no || m.phone}</span>
                      </AsyncButton>
                    ))}
                  </div>
                )}
              </div>

              {/* 金额 */}
              <div className="cashier-summary bg-white rounded-lg border border-gray-200 px-3 py-2 space-y-1 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>折前合计</span>
                  <span>{fmtMoney(order.subtotal)}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>折扣优惠</span>
                    <span className="text-red-500">-{fmtMoney(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-800 text-base">
                  <span>应收</span>
                  <span>{fmtMoney(order.payable)}</span>
                </div>
                {order.paid > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>{Number(order.booking_deposit || 0) > 0 ? '已收（含预约订金）' : '已收'}</span>
                    <span>{fmtMoney(order.paid)}</span>
                  </div>
                )}
                {Number(order.booking_deposit || 0) > 0 && (
                  <div className="flex justify-between text-sky-600 text-xs">
                    <span>预约订金已抵扣</span>
                    <span>{fmtMoney(Number(order.booking_deposit))}</span>
                  </div>
                )}
                <div className="flex justify-between text-brand-600 font-semibold">
                  <span>待收</span>
                  <span>{fmtMoney(unpaid)}</span>
                </div>
              </div>

              {order.status === 'open' && (
                <>
                  <div className="grid grid-cols-4 gap-1.5">
                    {can(user, 'discount') && (
                      <button className="btn-secondary text-xs px-1 py-1.5" onClick={openDiscount}>
                        折扣
                      </button>
                    )}
                    <AsyncButton className="btn-secondary text-xs px-1 py-1.5" onClick={openChangeRoom} disabled={!canOperate(user,'orderEdit')}>
                      转房
                    </AsyncButton>
                    <AsyncButton className="btn-secondary text-xs px-1 py-1.5" onClick={openLink} disabled={!canOperate(user,'orderEdit')}>
                      联房{groupOrders.length > 0 ? `(${groupOrders.length + 1})` : ''}
                    </AsyncButton>
                    <button
                      className="btn-secondary text-xs px-1 py-1.5 text-violet-600"
                      onClick={() => doItemAction(suspendOrder, '挂单', '挂单将暂存订单并释放房间与技师，确定？')} disabled={!canOperate(user,'orderEdit')}
                    >
                      挂单
                    </button>
                  </div>

                  {/* 支付方式（2列网格，确保常见窗口高度下全部可见、无需滚动） */}
                  <div className="space-y-1.5">
                    <div className="text-xs text-gray-500">支付方式（可组合）</div>
                    <div className="grid grid-cols-2 gap-1">
                      {paymentMethods.map((method) => {
                        const isVoucher = method.name === '美团' || method.name === '抖音'
                        return (
                          <div key={method.code} className="bg-white rounded-lg border border-gray-200 px-2 py-1">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-gray-600 shrink-0">{method.name}</span>
                              <input
                                aria-label={`${method.name}收款金额`}
                                className="min-w-0 flex-1 text-right text-sm focus:outline-none"
                                type="number"
                                min={0}
                                value={payAmounts[method.code] || ''}
                                placeholder="0.00"
                                onChange={(e) => setPayAmounts((prev) => ({ ...prev, [method.code]: e.target.value }))}
                              />
                            </div>
                            <div className="flex items-center justify-end gap-1.5 mt-0.5">
                              <button
                                aria-label={`全部使用${method.name}收款`}
                                className="text-[11px] text-brand-600 font-medium"
                                onClick={() => setPayAmounts({ [method.code]: unpaid.toFixed(2) })}
                              >
                                全部
                              </button>
                              {(method.code === '微信' || method.code === '支付宝') && (
                                <button
                                  className="text-[11px] text-sky-600 hover:text-sky-700 border border-sky-200 rounded px-1 py-0.5 whitespace-nowrap"
                                  title="顾客扫码付款后，确认到账再点结账"
                                  onClick={() => setQrShow(method)}
                                >
                                  收款码
                                </button>
                              )}
                            </div>
                            {isVoucher && (
                              <input
                                className="w-full mt-1 pt-1 border-t border-gray-100 text-xs focus:outline-none"
                                type="text"
                                value={voucherCodes[method.code] || ''}
                                placeholder="券码（可多个，逗号分隔）"
                                onChange={(e) => setVoucherCodes((prev) => ({ ...prev, [method.code]: e.target.value }))}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                </>
              )}
              </div>
              {/* 底部固定操作条：结账/反结账 永远可见，不随内容滚动、不被任何界面遮挡 */}
              {order.status === 'open' ? (
                <div className="shrink-0 border-t border-gray-200 bg-gray-50 p-3">
                  {blockedClocks.length > 0 && <div className="text-xs text-amber-800 mb-2">
                    有 {blockedClocks.length} 项服务待确认上钟或已暂停，需先处理钟单。
                    <button className="underline ml-2" onClick={() => setShowClockTerminal(true)}>处理本单报钟</button>
                  </div>}
                  {checkoutError && <p role="alert" className="mb-2 text-sm text-red-700 whitespace-normal break-words">{checkoutError}</p>}
                  <button className="btn-primary w-full py-3 text-base disabled:cursor-not-allowed disabled:opacity-60" disabled={settling || !baseLoaded || !!orderError || !!baseError} onClick={settle}>
                    {settling ? '结账处理中…' : `结 账（待收 ${fmtMoney(unpaid)}）`}
                  </button>
                </div>
              ) : order.status === 'closed' && can(user, 'reverseSettle') ? (
                <div className="shrink-0 border-t border-gray-200 bg-gray-50 p-3">
                  <button className="btn-secondary w-full" onClick={() => doItemAction(() => api.reverseSettle(order.id, user.id, order.version).then(reload), '反结账', '确认反结账？将重新打开该订单')}>
                    ↩️ 反结账
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* 加项目弹窗 */}
      <Modal
        open={!!addTarget}
        title={`添加${addTarget?.type === 'service' ? '服务' : '商品'}：${addTarget?.name || ''}`}
        onClose={() => setAddTarget(null)}
        width="max-w-md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setAddTarget(null)}>
              取消
            </button>
            <AsyncButton className="btn-primary" onClick={confirmAdd} disabled={!canOperate(user,'orderEdit')}>
              添加
            </AsyncButton>
          </>
        }
      >
        {addTarget ? (
          addTarget.type === 'service' ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="label">派钟方式</label>
                <div className="flex gap-1">
                  {['轮钟', '点钟', '加钟', '半钟', '排钟'].map((st) => (
                    <button key={st} className={`flex-1 py-2 rounded-lg text-sm border ${addServiceType === st ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-600'}`} onClick={() => setAddServiceType(st)}>
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label className="label">指定技师（轮钟不选将自动派给今日上钟最少的可用技师）</label>
              <select className="input" value={addTechId} onChange={(e) => setAddTechId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">不指定</option>
                {availableTechs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code}号 {t.name}（{t.level}）
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">单价</span>
              <span className="font-semibold">{fmtMoney(addTarget.price)}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label">数量</label>
              <div className="flex items-center gap-2">
                <button className="btn-secondary w-9" onClick={() => setAddQty(Math.max(1, addQty - 1))}>
                  -
                </button>
                <input className="input text-center w-20" type="number" min={1} value={addQty} onChange={(e) => setAddQty(Math.max(1, Number(e.target.value)))} />
                <button className="btn-secondary w-9" onClick={() => setAddQty(addQty + 1)}>
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">合计</span>
              <span className="font-semibold">{fmtMoney((addTarget?.price ?? 0) * addQty)}</span>
            </div>
          </div>
          )) : null}
      </Modal>

      {/* 派技师/换技师：不能直接清空技师，必须明确选择可用技师后提交 */}
      <Modal
        open={!!techTarget}
        title={`${techTarget?.technician_id ? '换技师' : '派技师'}：${techTarget?.item_name || ''}`}
        onClose={() => setTechTarget(null)}
        width="max-w-md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setTechTarget(null)}>取消</button>
            <AsyncButton className="btn-primary" disabled={(!changeTechId)||!canOperate(user,'assignTechnician')} onClick={async () => {
              if (!techTarget || !changeTechId) return
              if (await changeTech(techTarget.id, Number(changeTechId), techTarget.service_type)) setTechTarget(null)
            }}>确认派钟</AsyncButton>
          </>
        }
      >
        <div className="space-y-2">
          <label className="label">可用技师</label>
          <select className="input" value={changeTechId} onChange={(e) => setChangeTechId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">请选择技师</option>
            {sortTechnicians(techs.filter((t) => t.status !== 'serving' || t.id === techTarget?.technician_id)).map((t) => (
              <option key={t.id} value={t.id}>{t.code}号 {t.name}（{t.level}，今日{t.served_today || 0}钟）</option>
            ))}
          </select>
          {!techTarget?.technician_id && <p className="text-xs text-gray-500">轮钟新项目会自动派给今日上钟最少的可用技师；此处用于补派历史未派钟项目。</p>}
        </div>
      </Modal>

      {/* 折扣弹窗 */}
      <Modal
        open={showDiscount}
        title="折扣 / 优惠"
        onClose={() => setShowDiscount(false)}
        width="max-w-md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowDiscount(false)}>
              取消
            </button>
            <AsyncButton className="btn-primary" onClick={applyDiscount}>
              应用
            </AsyncButton>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { k: 'rate', label: '整单折' },
                { k: 'amount', label: '优惠减免' },
                { k: 'round', label: '抹零' },
                { k: 'free', label: '免单' }
              ] as const
            ).map((o) => (
              <button key={o.k} className={`py-2 rounded-lg text-sm border ${discType === o.k ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-600'}`} onClick={() => setDiscType(o.k)}>
                {o.label}
              </button>
            ))}
          </div>
          {discType === 'rate' && (
            <div>
              <label className="label">折扣（如 88 表示 88 折）</label>
              <input
                className="input"
                type="number"
                min="1"
                max="100"
                step="0.1"
                inputMode="decimal"
                value={discValue}
                onChange={(e) => setDiscValue(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">可填 1–100；100 表示不打折。全额减免请使用「免单」。</p>
            </div>
          )}
          {discType === 'amount' && (
            <div>
              <label className="label">减免金额</label>
              <input
                className="input"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={discAmount}
                onChange={(e) => setDiscAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          )}
          {(discType === 'round' || discType === 'free') && <div className="text-sm text-gray-500">{discType === 'round' ? '将抹去金额的小数部分' : '整单免单（应收为0）'}</div>}
        </div>
      </Modal>

      {/* 转房弹窗 */}
      <Modal
        open={showChangeRoom}
        title="转房"
        onClose={() => setShowChangeRoom(false)}
        width="max-w-sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowChangeRoom(false)}>
              取消
            </button>
            <AsyncButton className="btn-primary" onClick={doChangeRoom} disabled={!canOperate(user,'orderEdit')}>
              确认转房
            </AsyncButton>
          </>
        }
      >
        <label className="label">目标房间</label>
        <select className="input" value={changeRoomId} onChange={(e) => setChangeRoomId(Number(e.target.value))}>
          <option value="">请选择空闲房间</option>
          {idleRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.room_name}
            </option>
          ))}
        </select>
      </Modal>

      {/* 联房弹窗 */}
      <Modal
        open={showLink}
        title="联房管理"
        onClose={() => setShowLink(false)}
        width="max-w-md"
        footer={
          <button className="btn-secondary" onClick={() => setShowLink(false)}>
            关闭
          </button>
        }
      >
        {/* 当前联房组 */}
        {groupOrders.length > 0 && (
          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-1.5">当前联房组（{groupOrders.length + 1} 间）</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-violet-50 border border-violet-200 text-sm">
                <span className="font-medium">{order.room?.room_name || order.room_no || order.order_no}（本单）</span>
                <span className="text-xs text-gray-500">{fmtMoney(order.subtotal)}</span>
              </div>
              {groupOrders.map((g) => (
                <div key={g.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm">
                  <span>{g.room_name || g.room_no || g.order_no}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{fmtMoney(g.subtotal)}</span>
                    <AsyncButton className="text-xs text-red-500 hover:underline" onClick={() => doUnlink(g.id)} disabled={!canOperate(user,'orderEdit')}>
                      解除
                    </AsyncButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 可关联订单 */}
        <div className="text-xs text-gray-500 mb-1.5">选择要联房的进行中订单</div>
        {linkableOrders.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-4">暂无其他进行中订单</div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {linkableOrders.map((o) => (
              <AsyncButton
                key={o.id}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm text-left"
                onClick={() => doLink(o.id)} disabled={!canOperate(user,'orderEdit')}
              >
                <span>
                  {o.room_name || o.room_no || o.order_no}
                  {o.customer_name && <span className="text-gray-400 ml-2 text-xs">{o.customer_name}</span>}
                </span>
                <span className="text-xs text-gray-500">{fmtMoney(o.subtotal)}</span>
              </AsyncButton>
            ))}
          </div>
        )}
      </Modal>

      {/* 优惠券弹窗 */}
      <Modal
        open={showCoupon}
        title="使用优惠券"
        onClose={() => setShowCoupon(false)}
        width="max-w-sm"
        footer={
          <button className="btn-secondary" onClick={() => setShowCoupon(false)}>
            关闭
          </button>
        }
      >
        {coupons.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-6">该会员暂无可用优惠券</div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {coupons.map((c) => (
              <AsyncButton
                key={c.id}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-gray-200 hover:border-violet-300 hover:bg-violet-50 text-left"
                onClick={() => useCoupon(c.id)} disabled={!canOperate(user,'orderEdit')}
              >
                <div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-gray-400">
                    {c.type === 'discount' ? `折扣 ${(c.value * 100).toFixed(0)} 折` : `代金 ¥${c.value}`}
                    {c.min_amount > 0 ? ` · 满¥${c.min_amount}可用` : ''}
                    {c.expire_at ? ` · 有效期至 ${c.expire_at?.slice(0, 10)}` : ''}
                  </div>
                </div>
                <span className="text-xs text-violet-600 font-medium shrink-0 ml-2">使用</span>
              </AsyncButton>
            ))}
          </div>
        )}
      </Modal>

      {/* 确认 */}
      <Confirm
        open={!!confirmAction}
        title={confirmAction?.title || ''}
        message={confirmAction?.msg || ''}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          if (confirmAction) {
            await confirmAction.fn()
          }
          setConfirmAction(null)
        }}
      />

      {/* 结账明细 */}
      <Modal open={showClockTerminal} title="本单报钟处理" onClose={() => { setShowClockTerminal(false); void loadOrder().catch(error => toast(error instanceof Error ? error.message : '账单刷新失败', 'error')) }} width="max-w-6xl">
        {showClockTerminal && <Suspense fallback={<p role="status">正在加载本单钟单…</p>}><ClockTerminal orderId={order.id} /></Suspense>}
      </Modal>
      {settlementDetails && (
        <SettlementDetailsModal order={settlementDetails} settings={settings} onClose={() => setSettlementDetails(null)} />
      )}

      {/* 出示收款码（试营业人工核销） */}
      {qrShow && (
        <DialogLayer title="收款码" onClose={() => setQrShow(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[340px] max-w-[92vw] p-6 text-center" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-800">{qrShow.name} 收款码</h3>
            <div className="mt-3">
              <div className="text-xs text-gray-400">请向顾客出示，收款金额</div>
              <div className="text-3xl font-bold text-brand-600 my-1">{fmtMoney(order.payable)}</div>
              {unpaid > 0 && <div className="text-xs text-gray-500">本次待收 {fmtMoney(unpaid)}</div>}
            </div>
            {settings[`qr_${qrShow.code}`] ? (
              <img
                src={settings[`qr_${qrShow.code}`]}
                alt={`${qrShow.name}收款码`}
                className="mx-auto mt-3 w-52 h-52 object-contain rounded-lg border border-gray-200"
              />
            ) : (
              <div className="mx-auto mt-3 w-52 h-40 flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 text-xs text-gray-400 px-4 gap-1">
                <span>未配置{qrShow.name}收款码</span>
                <span>请在 系统设置 → 支付方式 上传</span>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-3 leading-5">
              顾客扫码付款（自填金额）后，回到本面板在该方式填入金额并点「结账」确认到账。试营业期间人工核销，闭店前请核对到账流水。
            </p>
            <button className="btn-primary w-full mt-4" onClick={() => setQrShow(null)}>
              知道了
            </button>
          </div>
        </DialogLayer>
      )}
    </div>
  )

  function confirmQuickAdd(item: Item): void {
    setAddTarget(item)
    setAddQty(1)
  }
}

function SettlementDetailsModal(props: { order: Order; settings: Settings; onClose: () => void }): JSX.Element {
  const user=useAuth(s=>s.user)!
  const { order, settings } = props
  const currentStore = useAuth(s => s.stores.find(store => store.id === s.currentStoreId))
  const [refunding, setRefunding] = useState(false)
  const [armRefund, setArmRefund] = useState(false)
  const items = (order.items || []).filter((i) => i.status !== 'refunded' && !i.is_refund)

  const refundDeposit = async (): Promise<void> => {
    if (!armRefund) {
      setArmRefund(true)
      return
    }
    setArmRefund(false)
    setRefunding(true)
    try {
      const res = await api.refundDeposit(order.id, order.version)
      if (res.ok) {
        toast('押金已退还')
        props.onClose()
      } else {
        toast(res.msg || '操作失败', 'error')
      }
    } catch {
      toast('操作失败', 'error')
    } finally {
      setRefunding(false)
    }
  }
  const receipt = (
        <div className="text-center text-sm receipt-sheet">
          <h3 className="text-lg font-bold mb-1">{settings.store_name || currentStore?.name || BRAND_NAME}</h3>
          <div className="text-xs text-gray-500 mb-3">{order.status === 'closed' ? '结账明细' : '已取消订单'}</div>
          {settings.store_address && <p className="text-xs">{settings.store_address}</p>}
          {settings.store_phone && <p className="text-xs">{settings.store_phone}</p>}
          <div className="text-xs text-gray-500 mb-3 space-y-0.5">
            <div>单号：{order.order_no}</div>
            <div>房间：{order.room_name || order.room?.room_name || '-'}</div>
            <div>时间：{fmtDateTime(order.closed_at || order.opened_at)}</div>
          </div>
          <div className="border-t border-dashed border-gray-300 py-2 space-y-1">
            {items.map((it) => (
              <div key={it.id} className="flex justify-between text-xs">
                <span>
                  {it.item_name} ×{it.quantity}
                </span>
                <span>{it.is_gift ? '赠送' : fmtNum(it.amount)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-dashed border-gray-300 py-2 space-y-1">
            <div className="flex justify-between text-xs">
              <span>折前</span>
              <span>{fmtNum(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>优惠</span>
              <span>-{fmtNum(order.discount)}</span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span>实收</span>
              <span>{fmtNum(order.paid)}</span>
            </div>
            {Number(order.booking_deposit || 0) > 0 && (
              <div className="flex justify-between text-xs text-sky-700">
                <span>其中预约订金</span>
                <span>{fmtNum(Number(order.booking_deposit))}</span>
              </div>
            )}
          </div>
          {(order.payments || []).length > 0 && (
            <div className="border-t border-dashed border-gray-300 py-2 space-y-1">
              {order.payments!.map((p) => (
                <div key={p.id} className="flex justify-between text-xs">
                  <span>
                    {p.method}
                    {p.voucher_code ? `（${p.voucher_code}）` : ''}
                  </span>
                  <span>{fmtNum(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
          {Number(order.deposit || 0) > 0 && (
            <div className="border-t border-dashed border-gray-300 py-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span>手牌押金（{order.wristband_no || '-'}）</span>
                <span>{fmtNum(order.deposit)}</span>
              </div>
              {order.deposit_refunded ? (
                <div className="text-[10px] text-emerald-600">✅ 押金已退还</div>
              ) : (
                <button
                  className={`text-[11px] underline ${armRefund ? 'text-red-500 font-semibold' : 'text-sky-600'}`}
                  onClick={refundDeposit}
                  disabled={refunding||!can(user,'refund')}
                >
                  {refunding ? '处理中...' : armRefund ? '⚠️ 再点一次确认已退还' : '↩️ 已退押金，核销'}
                </button>
              )}
            </div>
          )}
        </div>
  )
  return (
    <DialogLayer title="结账明细" onClose={props.onClose}>
      <div className="bg-white rounded-lg shadow-2xl w-[340px] p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div data-testid="settlement-details">{receipt}</div>
        {createPortal(<div id="saas-receipt-print" aria-hidden="true">{receipt}</div>, document.body)}
        <div className="flex gap-2 mt-4">
          {order.status === 'closed' && <AsyncButton className="btn-primary flex-1" onClick={async () => {
            if (window.saasDesktop) { const result = await window.saasDesktop.print(); if (!result.printed) throw Error('打印未完成') }
            else window.print()
          }}>打印小票</AsyncButton>}
          <button className="btn-secondary flex-1" onClick={props.onClose}>
            关闭
          </button>
        </div>
      </div>
    </DialogLayer>
  )
}
