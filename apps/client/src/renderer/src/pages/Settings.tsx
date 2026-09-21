import {usePageTab} from '../hooks/usePageTab'
import {canOperate,can} from '../utils/permissions'
import type {Operation} from '@za-spa/contracts'
import CouponCampaigns from '../components/CouponCampaigns'
import MaintenanceLogs from '../components/MaintenanceLogs'
import DeviceInterfaces from '../components/DeviceInterfaces'
import MarketingWorkflows from '../components/MarketingWorkflows'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getServerUrl } from '../api'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { fmtDateTime, ROLE_LABELS, parseMoneyInput } from '../utils/format'
import { Modal, Confirm, Badge, EmptyState, AsyncButton } from '../components/ui'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import OwnerConsole from './OwnerConsole'
import {exportBusiness} from '../api/export'
import CommissionRules from './CommissionRules'

type Tab = 'store' | 'rooms' | 'users' | 'discount' | 'pricing' | 'booking_payment' | 'pay' | 'logs' | 'stores' | 'wristbands' | 'levels' | 'plans' | 'announcements' | 'claim' | 'marketing' | 'channels' | 'commission' | 'approvals' | 'devices' | 'maintenance'

const emptyPricingForm = {
  id: undefined as number | undefined, name: '', priority: 100, item_id: 0, weekdays: [] as number[],
  start_time: '', end_time: '', effective_from: '', effective_to: '', room_type: '', technician_level: '', member_level: '',
  adjustment_type: 'fixed', adjustment_value: '', stack_mode: 'stack', enabled: 1
}

export default function Settings(): JSX.Element {
  const user = useAuth((s) => s.user)!
  const currentStoreId = useAuth((s) => s.currentStoreId)
  const [tab, setTab] = usePageTab<Tab>('store',['store','rooms','users','discount','pricing','booking_payment','pay','logs','stores','wristbands','levels','plans','announcements','claim','marketing','channels','commission','approvals','devices','maintenance'])
  const [loadError,setLoadError]=useState('')
  const tabOperation:Partial<Record<Tab,Operation>>={store:'settingsManage',rooms:'catalogManage',wristbands:'catalogManage',discount:'settingsManage',pricing:'catalogManage',booking_payment:'settingsManage',commission:'settingsManage',pay:'settingsManage',levels:'catalogManage',plans:'catalogManage',devices:'settingsManage',channels:'settingsManage',announcements:'announcementManage'}
  const readOnly=Boolean(tabOperation[tab]&&!canOperate(user,tabOperation[tab]!))
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [store, setStore] = useState({ store_name: '', store_address: '', store_phone: '', open_hours: '', points_rate: '1', member_day: '' })
  const [rooms, setRooms] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [schemes, setSchemes] = useState<any[]>([])
  const [payMethods, setPayMethods] = useState<string[]>([])
  const [commissionTiers, setCommissionTiers] = useState<any[]>([])
  const [approvals, setApprovals] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any>({ summary: {}, list: [] })
  const [approvalThresholds, setApprovalThresholds] = useState({ refund: '0', discount: '0', inventory_adjustment: '0' })
  const [pendingApprovalSave, setPendingApprovalSave] = useState<{ refund: number; discount: number; inventory_adjustment: number } | null>(null)
  const [storesList, setStoresList] = useState<any[]>([])
  const [wristbandsList, setWristbandsList] = useState<any[]>([])
  const [wristbandCodes, setWristbandCodes] = useState('')
  const bandAddBusy=useRef(false)
  const [bandAdding,setBandAdding]=useState(false)
  const bandPending=useRef<string[]|null>(null)
  useEffect(()=>{bandPending.current=null;setWristbandCodes('')},[currentStoreId])
  const [bandBinding, setBandBinding] = useState<{ id: number; code: string; room_id: number | ''; card_uid: string; reason: string } | null>(null)
  const bindingBusy = useRef(false)
  const [bindingSaving, setBindingSaving] = useState(false)
  const [storeForm, setStoreForm] = useState({ code: '', name: '', short_name: '' })
  // 会员等级 / 充值方案 / 公告
  const [levels, setLevels] = useState<any[]>([])
  const [levelForm, setLevelForm] = useState({ id: undefined as number | undefined, name: '', min_consume: '0', discount: '1', sort_order: 0 })
  const [plans, setPlans] = useState<any[]>([])
  const [planForm, setPlanForm] = useState({ id: undefined as number | undefined, name: '', amount: 0, gift_amount: 0, active: 1, sort_order: 0 })
  const [announcements, setAnnouncements] = useState<any[]>([])
  const [annForm, setAnnForm] = useState({ id: undefined as number | undefined, title: '', content: '', active: 1 })
  // 领券中心
  const [channelConnections, setChannelConnections] = useState<any[]>([])
  const [channelOrders, setChannelOrders] = useState<any[]>([])
  const [channelSecrets, setChannelSecrets] = useState<Record<string, string>>({})
  const [channelMerchantRefs, setChannelMerchantRefs] = useState<Record<string, string>>({})
  const [pricingRules, setPricingRules] = useState<any[]>([])
  const [pricingItems, setPricingItems] = useState<any[]>([])
  const [pricingForm, setPricingForm] = useState({ ...emptyPricingForm })
  const [pricingPreview, setPricingPreview] = useState<any>(null)
  const [bookingPolicy, setBookingPolicy] = useState({ deposit_type: 'fixed', deposit_value: '0', payment_timeout_minutes: '15', free_cancel_hours: '4', late_cancel_fee_percent: '100' })
  const [bookingProviders, setBookingProviders] = useState<any[]>([])
  const [bookingProviderForms, setBookingProviderForms] = useState<Record<string, any>>({})
  const [bookingPayments, setBookingPayments] = useState<any[]>([])
  const [bookingRefunds, setBookingRefunds] = useState<any[]>([])
  const [bookingReconciliation, setBookingReconciliation] = useState<any>(null)

  const load = useCallback(async () => {
    try {
    const s = await api.getSettings()
    setSettings(s)
    setBookingPolicy({
      deposit_type: s.booking_deposit_type === 'percent' ? 'percent' : 'fixed',
      deposit_value: s.booking_deposit_value ?? '0',
      payment_timeout_minutes: s.booking_payment_timeout_minutes || '15',
      free_cancel_hours: s.booking_free_cancel_hours ?? '4',
      late_cancel_fee_percent: s.booking_late_cancel_fee_percent ?? '100'
    })
    setStore({ store_name: s.store_name || '', store_address: s.store_address || '', store_phone: s.store_phone || '', open_hours: s.open_hours || '', points_rate: s.points_rate || '1', member_day: s.member_day || '' })
    try { setSchemes(JSON.parse(s.discount_schemes || '[]')) } catch { console.warn(JSON.stringify({ event: 'settings.parse_fallback', key: 'discount_schemes' })); setSchemes([]) }
    try { setPayMethods(JSON.parse(s.pay_methods || '[]')) } catch { console.warn(JSON.stringify({ event: 'settings.parse_fallback', key: 'pay_methods' })); setPayMethods([]) }
    try { setCommissionTiers(JSON.parse(s.commission_tiers || '[]')) } catch { console.warn(JSON.stringify({ event: 'settings.parse_fallback', key: 'commission_tiers' })); setCommissionTiers([]) }
    try { const t = JSON.parse(s.approval_thresholds || '{}'); setApprovalThresholds({ refund: String(t.refund ?? 0), discount: String(t.discount ?? 0), inventory_adjustment: String(t.inventory_adjustment ?? 0) }) } catch { console.warn(JSON.stringify({ event: 'settings.parse_fallback', key: 'approval_thresholds' })); setApprovalThresholds({ refund: '0', discount: '0', inventory_adjustment: '0' }) }
    const tasks: Array<Promise<unknown>>=[]
    if(tab==='rooms'||tab==='wristbands')tasks.push(api.listRooms().then(setRooms))
    if(tab==='logs')tasks.push(api.listLogs(200).then(setLogs))
    if(tab==='wristbands')tasks.push(api.listWristbands(true).then(setWristbandsList))
    if(tab==='levels')tasks.push(api.listMemberLevels().then(setLevels))
    if(tab==='plans')tasks.push(api.listRechargePlans().then(setPlans))
    if(tab==='announcements')tasks.push(api.listAnnouncements().then(setAnnouncements))
    if(tab==='channels')tasks.push(Promise.all([api.listChannelConnections(),api.listChannelOrders()]).then(([c,o])=>{setChannelConnections(c);setChannelOrders(o)}))
    if(tab==='booking_payment')tasks.push(Promise.all([api.listBookingPaymentProviders(),api.listBookingPayments(),api.listBookingRefunds(),api.bookingReconciliation()]).then(([p,b,r,c])=>{setBookingProviders(p);setBookingPayments(b);setBookingRefunds(r);setBookingReconciliation(c)}))
    if(tab==='pricing')tasks.push(Promise.all([api.listPricingRules(),api.getSnapshot()]).then(([r,s])=>{setPricingRules(r);setPricingItems([...(s.services||[]),...(s.products||[])])}))
    if(tab==='approvals')tasks.push(Promise.all([api.listApprovals('pending'),api.alerts()]).then(([a,b])=>{setApprovals(a);setAlerts(b)}))
    await Promise.all(tasks)
    setLoadError('')
    } catch(error) { setLoadError(error instanceof Error?error.message:'读取设置失败') }
  }, [tab])


  // 数据联动：跨机修改设置/房态/用户后自动刷新（本机写操作 bump 也触发）
  useAutoRefresh(load)

  const saveStore = async (): Promise<void> => {
    await api.saveSettings(store, user.id)
    // 门店名称同步刷新顶部下拉显示（stores 缓存），避免改完仍显示旧名
    if (currentStoreId) useAuth.getState().updateStoreName(currentStoreId, store.store_name)
    toast('门店信息已保存')
    await load()
  }

  const exportData = async (): Promise<void> => { const count=await exportBusiness();toast(`已导出 ${count} 条经营记录`) }

  const tabs: { k: Tab; label: string }[] = [
    { k: 'store', label: '门店信息' },

    { k: 'rooms', label: '房间管理' },
    { k: 'wristbands', label: '手牌管理' },
    ...(user.role==='owner'?[{ k: 'users' as Tab, label: '账号权限' }]:[]),
    { k: 'discount', label: '折扣方案' },
    { k: 'pricing', label: '动态定价' },
    { k: 'booking_payment', label: '预约订金' },
    { k: 'commission', label: '阶梯提成' },
    { k: 'approvals', label: `审批预警${approvals.length ? ` (${approvals.length})` : ''}` },
    { k: 'pay', label: '支付方式' },
    { k: 'levels', label: '会员等级' },
    { k: 'plans', label: '充值方案' },
    { k: 'claim', label: '领券中心' },
    { k: 'marketing', label: '自动营销' },
    { k: 'devices', label: '设备接口' },
    { k: 'channels', label: '渠道接入' },
    { k: 'announcements', label: '公告通知' },
    { k: 'logs', label: '操作日志' },
    ...(['owner','support'].includes(user.role)?[{k:'maintenance' as Tab,label:'维护日志'}]:[])
  ]

  // 审批阈值是否已配置：服务端 defaults 不含 approval_thresholds，从未保存过时该键不存在，
  // 借此区分「从未配置」与「显式设为 0」。任一子项缺失也视为未配置。
  const approvalThresholdsMissing = (() => {
    try { const parsed = JSON.parse(settings.approval_thresholds || ''); return !parsed || !['refund', 'discount', 'inventory_adjustment'].every((k) => typeof parsed[k] === 'number') } catch { return true }
  })()

  const persistApprovalThresholds = async (values: { refund: number; discount: number; inventory_adjustment: number }): Promise<void> => {
    await api.saveSettings({ approval_thresholds: JSON.stringify(values) }, user.id)
    toast('审批阈值已保存')
    await load()
  }

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <h2 className="text-lg font-bold text-gray-800">系统设置</h2>
        <div className="flex gap-2">
          {user.role==='owner'&&<AsyncButton className="btn-secondary" onClick={exportData}>导出经营数据</AsyncButton>}
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div aria-label="设置分类" className="settings-nav w-40 shrink-0 bg-white border-r border-gray-200 py-3 overflow-y-auto">
          {tabs.map((t) => (
            <button key={t.k} aria-pressed={tab === t.k} className={`w-full text-left px-4 py-2.5 text-sm ${tab === t.k ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`} onClick={() => setTab(t.k)}>
              {t.label}
            </button>
          ))}
        </div>
        <fieldset disabled={readOnly} className="flex-1 min-w-0 overflow-auto p-5">
          {readOnly&&<p role="status" className="mb-4 text-amber-700">当前账号可查看此页，未授权修改操作。</p>}
          {loadError&&<div role="alert" className="p-3 mb-4 bg-red-50 text-red-700">{loadError}<button className="btn-secondary ml-3" onClick={load}>重试</button></div>}
          {tab === 'store' && (
            <div className="card p-5 max-w-xl space-y-3">
              <div className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-700 leading-5">
                当前服务器：<b className="font-mono">{getServerUrl()}</b>
                <br />为保证软件端/Web 端与不同账号数据实时一致，所有设备请使用同一服务器地址；如发现某台设备连的是其他地址，请退出后用云端主库地址重新登录。
              </div>
              <div>
                <label className="label">门店名称</label>
                <input className="input" value={store.store_name} onChange={(e) => setStore({ ...store, store_name: e.target.value })} />
              </div>
              <div>
                <label className="label">门店地址</label>
                <input className="input" value={store.store_address} onChange={(e) => setStore({ ...store, store_address: e.target.value })} />
              </div>
              <div>
                <label className="label">联系电话</label>
                <input className="input" value={store.store_phone} onChange={(e) => setStore({ ...store, store_phone: e.target.value })} />
              </div>
              <div>
                <label className="label">营业时间</label>
                <input className="input" value={store.open_hours} onChange={(e) => setStore({ ...store, open_hours: e.target.value })} placeholder="如：12:00 - 02:00" />
              </div>
              <div className="border-t border-gray-100 pt-3 mt-1">
                <div className="text-sm font-semibold text-gray-700 mb-2">积分规则</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">消费赠积分（每元）</label>
                    <input className="input" type="number" step="0.1" min={0} value={store.points_rate} onChange={(e) => setStore({ ...store, points_rate: e.target.value })} placeholder="默认 1" />
                  </div>
                  <div>
                    <label className="label">会员日（每月几号，双倍积分）</label>
                    <input className="input" type="number" min={1} max={31} value={store.member_day} onChange={(e) => setStore({ ...store, member_day: e.target.value })} placeholder="如 8" />
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1">会员生日当天自动双倍积分；会员日与生日可叠加。</div>
              </div>
              <button className="btn-primary" onClick={saveStore}>保存门店信息</button>
            </div>
          )}

          {tab === 'wristbands' && (
            <div className="space-y-4 max-w-3xl">
              <p className="text-sm text-gray-500">固定手牌对应固定房间，结账只释放本次占用，不解除绑定。芯片卡号请填写读卡器实际输出，保留前导零。</p>
              <div className="card p-4">
                <div className="text-sm font-semibold text-gray-700 mb-3">批量添加手牌</div>
                <textarea
                  className="input w-full h-24"
                  disabled={bandAdding||!!bandPending.current}
                  value={wristbandCodes}
                  onChange={(e) => setWristbandCodes(e.target.value)}
                  placeholder="每行一个手牌编码，如：1001、1002..."
                />
                <button className="btn-primary mt-2" disabled={bandAdding} onClick={async () => {
                  if(bandAddBusy.current)return
                  const codes=bandPending.current??[...new Set(wristbandCodes.split(/[\n,，\s]+/).map(c=>c.trim()).filter(Boolean))]
                  if(!codes.length){toast('请输入手牌编码','error');return}
                  bandAddBusy.current=true;setBandAdding(true);bandPending.current=codes
                  try {
                    const result=await api.addWristbands(codes,user.id)
                    if(!result.ok){if(result.code!=='RESULT_UNKNOWN')bandPending.current=null;toast(result.msg||'添加失败','error');await load();return}
                    bandPending.current=null;setWristbandCodes('');toast('已添加 '+result.added+' 个手牌'+(result.skipped?'，已存在 '+result.skipped+' 个已跳过':''));await load()
                  }catch(e){toast(e instanceof Error?e.message:'操作失败，请核对原添加结果','error')}
                  finally{bandAddBusy.current=false;setBandAdding(false)}
                }}>{bandAdding?'处理中…':bandPending.current?'核对原添加结果':'添加手牌'}</button>
              </div>
              <div className="card overflow-hidden">
                <table className="table w-full">
                  <thead><tr><th>手牌号</th><th>固定房间 / 芯片卡号</th><th>本次占用</th><th>押金(元，0 表示不收押金)</th><th>操作</th></tr></thead>
                  <tbody>
                    {wristbandsList.map((w) => (
                      <tr key={w.id} className="hover:bg-gray-50">
                        <td className="font-mono">{w.code}</td>
                        <td><div>{w.room_name || w.room_no || '未配置固定房间'}</div><div className="text-xs text-gray-500">{w.card_uid || '尚未录入芯片卡号'}</div><button disabled={w.active===0} className="text-xs text-brand-600 disabled:opacity-40" onClick={() => setBandBinding({ id: w.id, code: w.code, room_id: w.room_id ?? '', card_uid: w.card_uid || '', reason: '' })}>配置固定绑定</button></td>
                        <td>{w.active===0?<Badge text="旧停用档案（可删除）" className="bg-gray-100 text-gray-500" />:w.status === 'idle' ? <Badge text="空闲" className="bg-emerald-50 text-emerald-600" /> : <Badge text="使用中" className="bg-amber-50 text-amber-600" />}</td>
                        <td>
                          <input
                            className="input !w-24 !py-1 text-xs"
                            type="number"
                            step="1"
                            min={0}
                            disabled={w.active===0}
                            defaultValue={w.deposit || 0}
                            onBlur={async (e) => {
                              const v = parseMoneyInput(e.target.value)
                              if (!Number.isFinite(v) || v < 0) { toast('押金请填写不小于 0 的数字', 'error'); e.target.value = String(w.deposit || 0); return }
                              const res = await api.setWristbandDeposit(w.id, v)
                              if (res.ok) toast(`手牌 ${w.code} 押金已设为 ¥${v}`)
                              else toast(res.msg || '保存失败', 'error')
                              await load()
                            }}
                          />
                        </td>
                        <td>
                          <button className="text-xs text-red-500 hover:underline" onClick={async () => {
                            const res = await api.removeWristband(w.id, user.id)
                            if (res.ok) { toast('手牌档案已彻底删除，编号可以重新添加'); await load() }
                            else toast(res.msg || '删除失败', 'error')
                          }}>删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {wristbandsList.length === 0 && <EmptyState text="暂无手牌，请先批量添加" />}
              </div>
              <Modal open={!!bandBinding} title={`固定房间绑定：${bandBinding?.code || ''}`} onClose={() => { if (!bindingBusy.current) setBandBinding(null) }} footer={<><button className="btn-secondary" disabled={bindingSaving} onClick={() => setBandBinding(null)}>取消</button><button className="btn-primary" disabled={bindingSaving} onClick={async () => {
                if (!bandBinding || bindingBusy.current) return
                if (!bandBinding.reason.trim()) { toast('请填写绑定或变更原因', 'error'); return }
                bindingBusy.current = true; setBindingSaving(true)
                try {
                  const res = await api.setWristbandBinding(bandBinding.id, { room_id: bandBinding.room_id || null, card_uid: bandBinding.card_uid.trim() || null, reason: bandBinding.reason.trim() })
                  if (!res.ok) { toast(res.msg || '保存失败', 'error'); return }
                  toast('固定绑定已保存，结账后仍保留'); setBandBinding(null); await load()
                } catch { toast('保存结果未确认，请刷新核对绑定', 'error') }
                finally { bindingBusy.current = false; setBindingSaving(false) }
              }}>保存固定绑定</button></>}>
                {bandBinding && <fieldset disabled={bindingSaving} className="space-y-3">
                  <label className="label">固定房间<select aria-label="手牌固定房间" className="input" value={bandBinding.room_id} onChange={e => setBandBinding({ ...bandBinding, room_id: e.target.value ? Number(e.target.value) : '' })}><option value="">解除固定绑定（需原因）</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.room_name || r.room_no}</option>)}</select></label>
                  <label className="label">芯片卡号（读卡原始值）<input aria-label="手牌芯片卡号" className="input" value={bandBinding.card_uid} onChange={e => setBandBinding({ ...bandBinding, card_uid: e.target.value })} /></label>
                  <label className="label">绑定或变更原因<input aria-label="手牌绑定原因" className="input" value={bandBinding.reason} onChange={e => setBandBinding({ ...bandBinding, reason: e.target.value })} /></label>
                  <p className="text-xs text-gray-500">仅管理角色可配置；有关联营业或挂单时禁止改绑。不会自动修改历史账单。</p>
                </fieldset>}
              </Modal>
            </div>
          )}

          {tab === 'rooms' && (
            <RoomSettings rooms={rooms} onReload={load} />
          )}

          {tab === 'users' && user.role==='owner' && (
            <OwnerConsole/>
          )}

          {tab === 'discount' && (
            <DiscountSettings schemes={schemes} onSave={async (s) => { await api.saveSettings({ discount_schemes: JSON.stringify(s) }, user.id); toast('已保存'); await load() }} />
          )}

          {tab === 'commission' && (
            <div><CommissionTiersSettings tiers={commissionTiers} onSave={async (t) => { await api.saveSettings({ commission_tiers: JSON.stringify(t) }, user.id); toast('已保存'); await load() }} /><CommissionRules/></div>
          )}

          {tab === 'approvals' && (
            <div className="space-y-4 max-w-5xl">
              <div className="card p-5">
                <div className="text-sm font-semibold text-gray-700 mb-1">敏感操作审批阈值</div>
                <p className="text-xs text-gray-500 mb-3">填 0 表示不启用审批；超过阈值时必须填写原因，待非申请人审核通过后才能再次执行。</p>
                {approvalThresholdsMissing && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 flex items-center justify-between gap-3"><span>当前未配置审批阈值：退款 / 折扣 / 库存调整<b>不需要审批</b>，敏感操作可直接执行。</span><span className="flex items-center gap-2 shrink-0"><button type="button" className="btn-secondary !py-1 text-xs" onClick={() => { setApprovalThresholds({ refund: '500', discount: '500', inventory_adjustment: '1000' }); toast('已填入建议值，请确认后点保存') }}>启用审批（填入建议值）</button><span className="text-xs text-gray-500">建议值，可自行修改</span></span></div>}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  {([['refund', '退款'], ['discount', '折扣'], ['inventory_adjustment', '库存调整']] as const).map(([key, label]) => <div key={key}><label className="label">{label}（元，0 表示不启用）</label><input className="input" type="number" min={0} value={approvalThresholds[key]} onChange={(e) => setApprovalThresholds({ ...approvalThresholds, [key]: e.target.value })} /></div>)}
                  <button className="btn-primary" disabled={user.role!=='owner'||!canOperate(user,'settingsManage')} title="审批阈值仅老板可修改" onClick={() => { const refund = parseMoneyInput(approvalThresholds.refund); const discount = parseMoneyInput(approvalThresholds.discount); const inventoryAdjustment = parseMoneyInput(approvalThresholds.inventory_adjustment); if (![refund, discount, inventoryAdjustment].every((v) => Number.isFinite(v) && v >= 0)) { toast('审批阈值请填写数字', 'error'); return } if (refund === 0 || discount === 0 || inventoryAdjustment === 0) { setPendingApprovalSave({ refund, discount, inventory_adjustment: inventoryAdjustment }); return } void persistApprovalThresholds({ refund, discount, inventory_adjustment: inventoryAdjustment }) }}>保存阈值（仅老板）</button>
                </div>
                <Confirm open={!!pendingApprovalSave} title="关闭审批确认" message="设为 0 表示关闭该项审批，退款 / 折扣 / 库存调整将不再需要审批。确定继续？" onCancel={() => setPendingApprovalSave(null)} onConfirm={async () => { const values = pendingApprovalSave; setPendingApprovalSave(null); if (values) await persistApprovalThresholds(values) }} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="card p-4"><div className="text-xs text-gray-500">待审批</div><div className="text-2xl font-bold text-red-600">{approvals.length}</div></div>
                <div className="card p-4"><div className="text-xs text-gray-500">高风险预警</div><div className="text-2xl font-bold text-red-600">{alerts.summary?.high || 0}</div></div>
                <div className="card p-4"><div className="text-xs text-gray-500">一般预警</div><div className="text-2xl font-bold text-amber-600">{alerts.summary?.warning || 0}</div></div>
                <div className="card p-4"><div className="text-xs text-gray-500">预警总数</div><div className="text-2xl font-bold">{alerts.summary?.total || 0}</div></div>
              </div>
              <div className="card overflow-hidden"><div className="px-4 py-3 border-b font-semibold text-sm">待审批操作</div><table className="table w-full"><thead><tr><th>时间</th><th>类型</th><th>申请人</th><th>原因</th><th>操作</th></tr></thead><tbody>{approvals.map((a) => <tr key={a.id}><td className="text-xs">{fmtDateTime(a.requested_at)}</td><td>{a.action_type}</td><td>{a.requester_name || '-'}</td><td>{a.reason}</td><td className="space-x-2"><button className="text-xs text-emerald-600 hover:underline" disabled={!can(user,'approve')||a.requested_by===user.id} onClick={async () => { const res = await api.reviewApproval(a.id, 'approved'); if (res.ok) { toast('已批准，请通知申请人重新执行操作'); await load() } else toast(res.msg || '操作失败', 'error') }}>批准</button><button className="text-xs text-red-500 hover:underline" disabled={!can(user,'approve')||a.requested_by===user.id} onClick={async () => { const res = await api.reviewApproval(a.id, 'rejected'); if (res.ok) { toast('已驳回'); await load() } else toast(res.msg || '操作失败', 'error') }}>驳回</button></td></tr>)}</tbody></table>{approvals.length === 0 && <EmptyState text="暂无待审批事项" />}</div>
              <div className="card overflow-hidden"><div className="px-4 py-3 border-b font-semibold text-sm">老板预警</div><div className="divide-y">{(alerts.list || []).map((a: any, i: number) => <div key={`${a.type}-${a.target_id}-${i}`} className="px-4 py-3 flex gap-3"><Badge text={a.severity === 'high' ? '高风险' : '预警'} className={a.severity === 'high' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'} /><div><div className="text-sm font-medium">{a.title}</div><div className="text-xs text-gray-500 mt-1">{a.detail}</div></div></div>)}</div>{!(alerts.list || []).length && <EmptyState text="当前没有异常预警" />}</div>
            </div>
          )}

          {tab === 'pay' && (
            <PaySettings methods={payMethods} qr={{ qr_微信: settings.qr_微信 || '', qr_支付宝: settings.qr_支付宝 || '' }} onSave={async (m) => { await api.saveSettings({ pay_methods: JSON.stringify(m) }, user.id); toast('已保存'); await load() }} onSaveAll={async (patch) => { await api.saveSettings(patch, user.id); toast('已保存'); await load() }} />
          )}

          {tab === 'logs' && (
            <div className="card overflow-hidden">
              <table className="table w-full">
                <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>详情</th></tr></thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="text-xs">{fmtDateTime(l.created_at)}</td>
                      <td>{l.user_name || '-'}</td>
                      <td><Badge text={l.action} className="bg-brand-50 text-brand-700" /></td>
                      <td className="text-gray-500 break-all">{typeof l.detail === 'object' ? JSON.stringify(l.detail) : l.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length === 0 && <EmptyState text="暂无日志" />}
            </div>
          )}

          {tab === 'levels' && (
            <div className="card p-5 max-w-2xl">
              <div className="text-sm font-semibold text-gray-700 mb-3">会员等级配置（结账会员卡自动按等级升级）</div>
              <div className="grid grid-cols-4 gap-3 mb-3">
                <input className="input" placeholder="等级名（如 黄金会员）" value={levelForm.name} onChange={(e) => setLevelForm({ ...levelForm, name: e.target.value })} />
                <input className="input" type="number" placeholder="累计消费门槛(元)" value={levelForm.min_consume} onChange={(e) => setLevelForm({ ...levelForm, min_consume: e.target.value })} />
                <input className="input" type="number" step="0.01" placeholder="折扣(0.9=9折)" value={levelForm.discount} onChange={(e) => setLevelForm({ ...levelForm, discount: e.target.value })} />
                <button
                  className="btn-primary"
                  onClick={async () => {
                    if (!levelForm.name) return toast('请填写等级名', 'error')
                    const minConsume = parseMoneyInput(levelForm.min_consume)
                    const discount = parseMoneyInput(levelForm.discount)
                    if (!Number.isFinite(discount) || discount <= 0 || discount > 1) return toast('会员等级折扣必须大于 0', 'error')
                    if (!Number.isFinite(minConsume) || minConsume < 0) return toast('会员等级消费门槛请填写不小于 0 的数字', 'error')
                    const res = await api.saveMemberLevel({ ...levelForm, min_consume: minConsume, discount })
                    if (res.ok) { toast('已保存'); setLevelForm({ id: undefined, name: '', min_consume: '0', discount: '1', sort_order: 0 }); setLevels(await api.listMemberLevels()) } else toast(res.msg || '保存失败', 'error')
                  }}
                >
                  {levelForm.id ? '更新' : '+ 新增'}
                </button>
              </div>
              <table className="table w-full">
                <thead><tr><th>等级</th><th>消费门槛</th><th>折扣</th><th>操作</th></tr></thead>
                <tbody>
                  {levels.map((l) => (
                    <tr key={l.id}>
                      <td className="font-medium">{l.name}</td>
                      <td>¥{l.min_consume}</td>
                      <td>{l.discount === 1 ? '无' : `${(l.discount * 10).toFixed(1)}折`}</td>
                      <td>
                        <button className="text-xs text-brand-600 hover:underline mr-2" onClick={() => setLevelForm({ id: l.id, name: l.name, min_consume: String(l.min_consume ?? ''), discount: String(l.discount ?? ''), sort_order: l.sort_order })}>编辑</button>
                        <button className="text-xs text-red-500 hover:underline" onClick={async () => { await api.deleteMemberLevel(l.id); setLevels(await api.listMemberLevels()) }}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {levels.length === 0 && <EmptyState text="暂无等级（默认普通会员）" />}
            </div>
          )}

          {tab === 'plans' && (
            <div className="card p-5 max-w-2xl">
              <div className="text-sm font-semibold text-gray-700 mb-3">充值方案（会员充值时一键套用「充X送Y」）</div>
              <div className="grid grid-cols-5 gap-3 mb-3">
                <input className="input" placeholder="方案名" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} />
                <input className="input" type="number" placeholder="充值金额" value={planForm.amount} onChange={(e) => setPlanForm({ ...planForm, amount: Number(e.target.value) })} />
                <input className="input" type="number" placeholder="赠送金额" value={planForm.gift_amount} onChange={(e) => setPlanForm({ ...planForm, gift_amount: Number(e.target.value) })} />
                <button className="btn-secondary" onClick={() => setPlanForm({ ...planForm, active: planForm.active ? 0 : 1 })}>{planForm.active ? '启用中' : '停用'}</button>
                <button
                  className="btn-primary"
                  onClick={async () => {
                    if (!planForm.name || !(planForm.amount > 0)) return toast('请填写方案名与充值金额', 'error')
                    const res = await api.saveRechargePlan(planForm)
                    if (res.ok) { toast('已保存'); setPlanForm({ id: undefined, name: '', amount: 0, gift_amount: 0, active: 1, sort_order: 0 }); setPlans(await api.listRechargePlans()) } else toast(res.msg || '保存失败', 'error')
                  }}
                >
                  {planForm.id ? '更新' : '+ 新增'}
                </button>
              </div>
              <table className="table w-full">
                <thead><tr><th>方案</th><th>充值</th><th>赠送</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td>¥{p.amount}</td>
                      <td className="text-emerald-600">+¥{p.gift_amount}</td>
                      <td>{p.active ? <Badge text="启用" className="bg-emerald-50 text-emerald-600" /> : <Badge text="停用" className="bg-gray-100 text-gray-500" />}</td>
                      <td>
                        <button className="text-xs text-brand-600 hover:underline mr-2" onClick={() => setPlanForm({ id: p.id, name: p.name, amount: p.amount, gift_amount: p.gift_amount, active: p.active, sort_order: p.sort_order })}>编辑</button>
                        <button className="text-xs text-red-500 hover:underline" onClick={async () => { await api.deleteRechargePlan(p.id); setPlans(await api.listRechargePlans()) }}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plans.length === 0 && <EmptyState text="暂无充值方案" />}
            </div>
          )}

          {tab === 'claim' && <CouponCampaigns key={currentStoreId}/>} 

          {tab === 'booking_payment' && (
            <div className="space-y-4 max-w-6xl">
              <div className="card p-5">
                <div className="text-sm font-semibold text-gray-700">预约订金与取消规则</div>
                <div className="text-xs text-gray-400 mt-1 mb-4">订金政策配置。线上支付接口尚未接入，当前不会向顾客发起扣款或自动退款。</div>
                <div className="grid grid-cols-5 gap-3">
                  <div><label className="label">订金方式</label><select className="input" value={bookingPolicy.deposit_type} onChange={(e) => setBookingPolicy({ ...bookingPolicy, deposit_type: e.target.value })}><option value="fixed">固定金额</option><option value="percent">项目价格百分比</option></select></div>
                  <div><label className="label">订金数值</label><input className="input" type="number" min={0} step="0.01" value={bookingPolicy.deposit_value} onChange={(e) => setBookingPolicy({ ...bookingPolicy, deposit_value: e.target.value })} /></div>
                  <div><label className="label">支付限时 分钟</label><input className="input" type="number" min={1} max={1440} value={bookingPolicy.payment_timeout_minutes} onChange={(e) => setBookingPolicy({ ...bookingPolicy, payment_timeout_minutes: e.target.value })} /></div>
                  <div><label className="label">免费取消 小时</label><input className="input" type="number" min={0} value={bookingPolicy.free_cancel_hours} onChange={(e) => setBookingPolicy({ ...bookingPolicy, free_cancel_hours: e.target.value })} /></div>
                  <div><label className="label">临时取消扣费 %</label><input className="input" type="number" min={0} max={100} value={bookingPolicy.late_cancel_fee_percent} onChange={(e) => setBookingPolicy({ ...bookingPolicy, late_cancel_fee_percent: e.target.value })} /></div>
                </div>
                <button className="btn-primary mt-4" onClick={async () => { try { const depositValue = parseMoneyInput(bookingPolicy.deposit_value); const timeoutMinutes = parseMoneyInput(bookingPolicy.payment_timeout_minutes); const freeCancelHours = parseMoneyInput(bookingPolicy.free_cancel_hours); const lateFeePercent = parseMoneyInput(bookingPolicy.late_cancel_fee_percent); if (!Number.isFinite(depositValue) || depositValue < 0) { toast('订金数值请填写不小于 0 的数字', 'error'); return } if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 1440) { toast('支付限时须为 1 至 1440 分钟', 'error'); return } if (!Number.isFinite(freeCancelHours) || freeCancelHours < 0) { toast('免费取消小时数请填写不小于 0 的数字', 'error'); return } if (!Number.isFinite(lateFeePercent) || lateFeePercent < 0 || lateFeePercent > 100) { toast('取消扣费比例须为 0 至 100', 'error'); return } await api.saveSettings({ booking_deposit_type: bookingPolicy.deposit_type, booking_deposit_value: String(depositValue), booking_payment_timeout_minutes: String(timeoutMinutes), booking_free_cancel_hours: String(freeCancelHours), booking_late_cancel_fee_percent: String(lateFeePercent) }, user.id); toast('预约订金规则已保存') } catch (e) { toast(e instanceof Error ? e.message : '保存失败', 'error') } }}>保存订金规则</button>
              </div>
              <div className="card p-5">
                <div className="text-sm font-semibold text-gray-700">支付渠道</div>
                <div className="text-xs text-amber-600 mt-1 mb-4">生产模式必须连接 HTTPS 支付网关。这里只保存适配层配置，不代表已获得微信或支付宝商户授权。</div>
                <div className="space-y-3">{(['wechat','alipay'] as const).map((provider) => { const row = bookingProviders.find((item) => item.provider === provider); const form = { enabled: Boolean(row?.enabled), merchant_ref: row?.merchant_ref || '', gateway_base_url: row?.gateway_base_url || '', mode: row?.mode || 'production', webhook_secret: '', ...(bookingProviderForms[provider] || {}) }; const setForm = (next: any) => setBookingProviderForms({ ...bookingProviderForms, [provider]: { ...form, ...next } }); return <div key={provider} className="rounded-lg border border-gray-200 p-4"><div className="flex items-center justify-between mb-3"><div className="font-medium text-gray-700">{provider === 'wechat' ? '微信支付' : '支付宝'}</div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ enabled: e.target.checked })} />启用</label></div><div className="grid grid-cols-4 gap-3"><input className="input" placeholder="商户标识" value={form.merchant_ref} onChange={(e) => setForm({ merchant_ref: e.target.value })} /><input className="input" placeholder="HTTPS 网关地址" value={form.gateway_base_url} onChange={(e) => setForm({ gateway_base_url: e.target.value })} /><input className="input" type="password" placeholder={row?.secret_configured ? '已配置，留空保留' : '签名密钥 至少24位'} value={form.webhook_secret} onChange={(e) => setForm({ webhook_secret: e.target.value })} /><select className="input" value={form.mode} onChange={(e) => setForm({ mode: e.target.value })}><option value="production">生产</option><option value="sandbox">沙箱</option></select></div><div className="mt-3 flex items-center justify-between"><span className="text-xs text-gray-400">回调：{row?.webhook_path || '接入后分配'}</span><button className="btn-secondary" onClick={async () => { try { await api.saveBookingPaymentProvider(provider, form); setBookingProviders(await api.listBookingPaymentProviders()); setBookingProviderForms({ ...bookingProviderForms, [provider]: {} }); toast('支付渠道配置已保存') } catch (e) { toast(e instanceof Error ? e.message : '保存失败', 'error') } }}>保存</button></div></div> })}</div>
              </div>
              <div className="grid grid-cols-4 gap-3">{[['订金收款', bookingReconciliation?.payment_amount || 0], ['退款金额', bookingReconciliation?.refund_amount || 0], ['净订金', bookingReconciliation?.net_deposit || 0], ['对账异常', bookingReconciliation?.anomalies?.length || 0]].map(([label, value], index) => <div key={String(label)} className="card p-4"><div className="text-xs text-gray-400">{label}</div><div className={`text-xl font-bold mt-1 ${index === 3 && Number(value) > 0 ? 'text-red-500' : 'text-gray-800'}`}>{index === 3 ? value : `¥${Number(value).toFixed(2)}`}</div></div>)}</div>
              <div className="grid grid-cols-2 gap-4">
                <div className="card overflow-x-auto"><div className="p-4 text-sm font-semibold text-gray-700">最近预约支付</div><table className="table w-full"><thead><tr><th>支付单</th><th>顾客</th><th>金额</th><th>状态</th></tr></thead><tbody>{bookingPayments.slice(0,10).map((row) => <tr key={row.id}><td className="font-mono text-xs">{row.payment_no}</td><td>{row.customer_name}</td><td>¥{Number(row.amount).toFixed(2)}</td><td>{row.status}</td></tr>)}</tbody></table>{bookingPayments.length === 0 && <EmptyState text="暂无预约支付" />}</div>
                <div className="card overflow-x-auto"><div className="p-4 text-sm font-semibold text-gray-700">最近预约退款</div><table className="table w-full"><thead><tr><th>退款单</th><th>顾客</th><th>退款</th><th>状态</th></tr></thead><tbody>{bookingRefunds.slice(0,10).map((row) => <tr key={row.id}><td className="font-mono text-xs">{row.refund_no}</td><td>{row.customer_name}</td><td>¥{Number(row.amount).toFixed(2)}</td><td>{row.status}</td></tr>)}</tbody></table>{bookingRefunds.length === 0 && <EmptyState text="暂无预约退款" />}</div>
              </div>
            </div>
          )}

          {tab === 'pricing' && (
            <div className="space-y-4 max-w-6xl">
              <div className="card p-5">
                <div className="text-sm font-semibold text-gray-700">动态定价规则</div>
                <div className="text-xs text-gray-400 mt-1 mb-4">支持时段、日期、房型、技师等级和会员等级；实际成交价由服务端计算并写入订单快照。</div>
                <div className="grid grid-cols-4 gap-3">
                  <div><label className="label">规则名称</label><input className="input" value={pricingForm.name} placeholder="如：周末晚间加价" onChange={(e) => setPricingForm({ ...pricingForm, name: e.target.value })} /></div>
                  <div><label className="label">适用项目</label><select className="input" value={pricingForm.item_id} onChange={(e) => setPricingForm({ ...pricingForm, item_id: Number(e.target.value) })}><option value={0}>全部项目</option>{pricingItems.map((item) => <option key={`${item.type}-${item.id}`} value={item.id}>{item.name}</option>)}</select></div>
                  <div><label className="label">调价方式</label><select className="input" value={pricingForm.adjustment_type} onChange={(e) => setPricingForm({ ...pricingForm, adjustment_type: e.target.value })}><option value="fixed">固定加减金额</option><option value="percent">按百分比加减</option><option value="override">指定成交价</option></select></div>
                  <div><label className="label">调价值</label><input className="input" type="number" step="0.01" min={pricingForm.adjustment_type === 'override' ? 0.01 : undefined} value={pricingForm.adjustment_value} onChange={(e) => setPricingForm({ ...pricingForm, adjustment_value: e.target.value })} />{pricingForm.adjustment_type === 'override' && <p className="text-xs text-gray-400 mt-1">指定成交价必须大于 0</p>}</div>
                  <div><label className="label">开始日期</label><input className="input" type="date" value={pricingForm.effective_from} onChange={(e) => setPricingForm({ ...pricingForm, effective_from: e.target.value })} /></div>
                  <div><label className="label">结束日期</label><input className="input" type="date" value={pricingForm.effective_to} onChange={(e) => setPricingForm({ ...pricingForm, effective_to: e.target.value })} /></div>
                  <div><label className="label">开始时间</label><input className="input" type="time" value={pricingForm.start_time} onChange={(e) => setPricingForm({ ...pricingForm, start_time: e.target.value })} /></div>
                  <div><label className="label">结束时间</label><input className="input" type="time" value={pricingForm.end_time} onChange={(e) => setPricingForm({ ...pricingForm, end_time: e.target.value })} /></div>
                  <div><label className="label">房型（留空不限）</label><input className="input" value={pricingForm.room_type} placeholder="如：VIP房" onChange={(e) => setPricingForm({ ...pricingForm, room_type: e.target.value })} /></div>
                  <div><label className="label">技师等级（留空不限）</label><input className="input" value={pricingForm.technician_level} placeholder="如：高级" onChange={(e) => setPricingForm({ ...pricingForm, technician_level: e.target.value })} /></div>
                  <div><label className="label">会员等级（留空不限）</label><input className="input" value={pricingForm.member_level} placeholder="如：金卡会员" onChange={(e) => setPricingForm({ ...pricingForm, member_level: e.target.value })} /></div>
                  <div><label className="label">优先级</label><input className="input" type="number" value={pricingForm.priority} onChange={(e) => setPricingForm({ ...pricingForm, priority: Number(e.target.value) })} /></div>
                </div>
                <div className="mt-3"><label className="label">适用星期（不选表示每天）</label><div className="flex gap-2">{['日','一','二','三','四','五','六'].map((label, day) => <button key={day} className={`px-3 py-1.5 rounded text-xs border ${pricingForm.weekdays.includes(day) ? 'bg-brand-50 border-brand-400 text-brand-700' : 'border-gray-200 text-gray-500'}`} onClick={() => setPricingForm({ ...pricingForm, weekdays: pricingForm.weekdays.includes(day) ? pricingForm.weekdays.filter((d) => d !== day) : [...pricingForm.weekdays, day] })}>周{label}</button>)}</div></div>
                <div className="mt-4 flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={pricingForm.stack_mode === 'stop'} onChange={(e) => setPricingForm({ ...pricingForm, stack_mode: e.target.checked ? 'stop' : 'stack' })} />命中后停止叠加后续规则</label>
                  <AsyncButton className="btn-primary" onClick={async () => { try { const adjustmentValue = parseMoneyInput(pricingForm.adjustment_value); if (pricingForm.adjustment_type === 'override') { if (!Number.isFinite(adjustmentValue) || adjustmentValue <= 0) { toast('指定成交价必须大于 0', 'error'); return } } else if (pricingForm.adjustment_type === 'percent') { if (!Number.isFinite(adjustmentValue) || adjustmentValue <= -100 || adjustmentValue > 10000) { toast('调价比例须大于 -100% 且不超过 10000%', 'error'); return } } else { if (!Number.isFinite(adjustmentValue)) { toast('调价金额请填写数字', 'error'); return } } await api.savePricingRule({ ...pricingForm, adjustment_value: adjustmentValue }); toast(pricingForm.id ? '价格规则已更新' : '价格规则已新增'); setPricingForm({ ...emptyPricingForm }); setPricingPreview(null); setPricingRules(await api.listPricingRules()) } catch (e) { toast(e instanceof Error ? e.message : '保存失败', 'error') } }}>{pricingForm.id ? '保存修改' : '+ 新增规则'}</AsyncButton>
                  <button className="btn-secondary" disabled={!pricingForm.item_id} onClick={async () => { try { setPricingPreview(await api.previewPrice({ item_id: pricingForm.item_id })) } catch (e) { toast(e instanceof Error ? e.message : '试算失败', 'error') } }}>按当前时刻试算</button>
                  {pricingForm.id && <button className="text-sm text-gray-500" onClick={() => { setPricingForm({ ...emptyPricingForm }); setPricingPreview(null) }}>取消编辑</button>}
                </div>
                {pricingPreview && <div className="mt-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">基础价 ¥{Number(pricingPreview.base_price).toFixed(2)} → 成交价 ¥{Number(pricingPreview.final_price).toFixed(2)}，命中 {pricingPreview.applied_rules?.length || 0} 条规则</div>}
              </div>
              <div className="card overflow-x-auto"><table className="table w-full"><thead><tr><th>规则</th><th>范围</th><th>调价</th><th>时段</th><th>叠加</th><th>状态</th><th>操作</th></tr></thead><tbody>{pricingRules.map((rule) => <tr key={rule.id}><td><div className="font-medium">{rule.name}</div><div className="text-xs text-gray-400">优先级 {rule.priority}</div></td><td>{rule.item_id ? pricingItems.find((item) => Number(item.id) === Number(rule.item_id))?.name || `项目 #${rule.item_id}` : '全部项目'}<div className="text-xs text-gray-400">{[rule.room_type, rule.technician_level, rule.member_level].filter(Boolean).join(' / ') || '不限条件'}</div></td><td>{rule.adjustment_type === 'override' ? `指定 ¥${rule.adjustment_value}` : rule.adjustment_type === 'percent' ? `${Number(rule.adjustment_value) >= 0 ? '+' : ''}${rule.adjustment_value}%` : `${Number(rule.adjustment_value) >= 0 ? '+' : ''}¥${rule.adjustment_value}`}</td><td>{rule.effective_from || rule.effective_to ? `${rule.effective_from || '不限'} 至 ${rule.effective_to || '不限'}` : '长期'}<div className="text-xs text-gray-400">{rule.start_time || rule.end_time ? `${rule.start_time || '00:00'}-${rule.end_time || '24:00'}` : '全天'}</div></td><td>{rule.stack_mode === 'stop' ? '命中即止' : '继续叠加'}</td><td>{rule.enabled ? <Badge text="启用" className="bg-emerald-50 text-emerald-600" /> : <Badge text="停用" className="bg-gray-100 text-gray-500" />}</td><td><button className="text-xs text-brand-600 mr-3" onClick={() => { setPricingForm({ ...emptyPricingForm, ...rule, weekdays: Array.isArray(rule.weekdays) ? rule.weekdays : [] }); setPricingPreview(null) }}>编辑</button>{rule.enabled ? <AsyncButton className="text-xs text-red-500" onClick={async () => { try { await api.deletePricingRule(rule.id, rule.version, '后台停用'); setPricingRules(await api.listPricingRules()); toast('规则已停用') } catch (e) { toast(e instanceof Error ? e.message : '停用失败', 'error') } }}>停用</AsyncButton> : null}</td></tr>)}</tbody></table>{pricingRules.length === 0 && <EmptyState text="暂无动态价格规则，项目仍按基础价销售" />}</div>
            </div>
          )}

          {tab === 'marketing' && <MarketingWorkflows key={currentStoreId} />}
          {tab === 'devices' && <DeviceInterfaces key={currentStoreId} />}
          {tab === 'maintenance' && <MaintenanceLogs key={currentStoreId} stores={useAuth.getState().stores.filter(s=>s.id===currentStoreId)}/>} 

          {tab === 'channels' && (
            <div className="space-y-4 max-w-5xl">
              <div className="card p-5"><div className="text-sm font-semibold text-gray-700">外部渠道订单与核销</div><div className="text-xs text-amber-600 mt-1">渠道接口已预留，当前尚未接入服务商。可保存加密配置；真实核销与收款暂未启用。</div></div>
              <div className="card overflow-x-auto"><table className="table w-full"><thead><tr><th>渠道</th><th>启用</th><th>商户标识</th><th>入站签名密钥</th><th>回调路径</th><th></th></tr></thead><tbody>{['meituan', 'douyin', 'wechat', 'miniprogram'].map((channel) => { const row = channelConnections.find((x) => x.channel === channel); const enabled = Boolean(row?.enabled); const merchantRef = channelMerchantRefs[channel] ?? row?.merchant_ref ?? ''; const save = async (nextEnabled = enabled) => { try { await api.saveChannelConnection(channel, { enabled: nextEnabled, merchant_ref: merchantRef, webhook_secret: channelSecrets[channel] || '' }); setChannelSecrets({ ...channelSecrets, [channel]: '' }); setChannelConnections(await api.listChannelConnections()); toast('渠道配置已保存') } catch (e) { toast(e instanceof Error ? e.message : '保存失败', 'error') } }; return <tr key={channel}><td className="font-medium">{{ meituan: '美团', douyin: '抖音', wechat: '微信', miniprogram: '小程序' }[channel]}</td><td><button className={enabled ? 'text-emerald-600 text-xs' : 'text-gray-400 text-xs'} onClick={() => void save(!enabled)}>{enabled ? '已启用' : '未接入'}</button></td><td><input className="input w-32" value={merchantRef} placeholder="商户号" onChange={(e) => setChannelMerchantRefs({ ...channelMerchantRefs, [channel]: e.target.value })} /></td><td><input className="input w-44" type="password" value={channelSecrets[channel] || ''} placeholder={row?.secret_configured ? '已配置，留空保留' : '至少 24 位'} onChange={(e) => setChannelSecrets({ ...channelSecrets, [channel]: e.target.value })} /></td><td className="text-xs text-gray-400">{row?.webhook_path || '接入后分配'}</td><td><button className="text-xs text-violet-600" onClick={() => void save()}>保存</button></td></tr> })}</tbody></table></div>
              <div className="card p-5"><div className="text-sm font-semibold text-gray-700 mb-3">待收银核销的渠道订单</div><table className="table w-full"><thead><tr><th>渠道</th><th>外部订单</th><th>券码</th><th>金额</th><th>状态</th></tr></thead><tbody>{channelOrders.slice(0, 20).map((o) => <tr key={o.id}><td>{o.channel}</td><td>{o.external_order_no}</td><td className="font-mono">{o.voucher_code}</td><td>¥{Number(o.amount).toFixed(2)}</td><td>{o.redemption_status || o.status}</td></tr>)}</tbody></table>{channelOrders.length === 0 && <EmptyState text="暂无已签名接入的渠道订单" />}</div>
            </div>
          )}

          {tab === 'announcements' && (
            <div className="card p-5 max-w-2xl">
              <div className="text-sm font-semibold text-gray-700 mb-3">公告通知（登录后首页展示启用的公告）</div>
              <div className="grid grid-cols-4 gap-3 mb-3">
                <input className="input" placeholder="公告标题" value={annForm.title} onChange={(e) => setAnnForm({ ...annForm, title: e.target.value })} />
                <input className="input col-span-2" placeholder="公告内容" value={annForm.content} onChange={(e) => setAnnForm({ ...annForm, content: e.target.value })} />
                <button
                  className="btn-primary"
                  onClick={async () => {
                    if (!annForm.title) return toast('请填写公告标题', 'error')
                    const res = await api.saveAnnouncement(annForm)
                    if (res.ok) { toast('已保存'); setAnnForm({ id: undefined, title: '', content: '', active: 1 }); setAnnouncements(await api.listAnnouncements()) } else toast(res.msg || '保存失败', 'error')
                  }}
                >
                  {annForm.id ? '更新' : '+ 新增'}
                </button>
              </div>
              <table className="table w-full">
                <thead><tr><th>标题</th><th>内容</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                  {announcements.map((a) => (
                    <tr key={a.id}>
                      <td className="font-medium">{a.title}</td>
                      <td className="text-gray-500">{a.content}</td>
                      <td>{a.active ? <Badge text="启用" className="bg-emerald-50 text-emerald-600" /> : <Badge text="停用" className="bg-gray-100 text-gray-500" />}</td>
                      <td>
                        <button className="text-xs text-brand-600 hover:underline mr-2" onClick={() => setAnnForm({ id: a.id, title: a.title, content: a.content, active: a.active })}>编辑</button>
                        <button className="text-xs text-red-500 hover:underline" onClick={async () => { await api.deleteAnnouncement(a.id); setAnnouncements(await api.listAnnouncements()) }}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {announcements.length === 0 && <EmptyState text="暂无公告" />}
            </div>
          )}
        </fieldset>
      </div>


    </div>
  )
}

function RoomSettings(props: { rooms: any[]; onReload: () => void }): JSX.Element {
  const user = useAuth((s) => s.user)!
  const [form, setForm] = useState<any>(null)

  const save = async (): Promise<void> => {
    if (!form) return
    const res = await api.saveRoom({ id: form.id, room_no: form.room_no, room_name: form.room_name || form.room_no, room_type: form.room_type, capacity: form.capacity }, user.id)
    if (res.ok) {
      toast('已保存')
      setForm(null)
      props.onReload()
    } else {
      toast(res.msg || '保存失败', 'error')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setForm({ id: undefined, room_no: '', room_name: '', room_type: '足浴房', capacity: 2 })}>+ 新增房间</button>
      </div>
      <div className="card overflow-hidden">
        <table className="table w-full">
          <thead><tr><th>房号</th><th>名称</th><th>类型</th><th>容纳</th><th>操作</th></tr></thead>
          <tbody>
            {props.rooms.map((r) => (
              <tr key={r.id}>
                <td>{r.room_no}</td>
                <td>{r.room_name}</td>
                <td>{r.room_type}</td>
                <td>{r.capacity}</td>
                <td>
                  <div className="flex gap-2">
                    <button className="text-xs text-brand-600 hover:underline" onClick={() => setForm({ ...r })}>编辑</button>
                    <button className="text-xs text-red-500 hover:underline" onClick={async () => { const res = await api.deleteRoom(r.id, user.id); if (res.ok) { toast('已删除'); props.onReload() } else toast(res.msg || '删除失败', 'error') }}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!form} title={form?.id ? '编辑房间' : '新增房间'} onClose={() => setForm(null)} footer={<><button className="btn-secondary" onClick={() => setForm(null)}>取消</button><button className="btn-primary" onClick={save}>保存</button></>}>
        {form && (
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">房号 *</label><input className="input" value={form.room_no} onChange={(e) => setForm({ ...form, room_no: e.target.value })} /></div>
            <div><label className="label">名称</label><input className="input" value={form.room_name} onChange={(e) => setForm({ ...form, room_name: e.target.value })} /></div>
            <div>
              <label className="label">类型</label>
              <select className="input" value={form.room_type} onChange={(e) => setForm({ ...form, room_type: e.target.value })}>
                {['足浴房', 'SPA房', 'K歌房', '大厅', 'VIP房'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="label">容纳人数</label><input className="input" type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function DiscountSettings(props: { schemes: any[]; onSave: (s: any[]) => void }): JSX.Element {
  const [schemes, setSchemes] = useState<any[]>(props.schemes)
  useEffect(() => setSchemes((props.schemes || []).map((s) => ({ ...s, value: String(s.value ?? '') }))), [props.schemes])

  return (
    <div className="card p-5 max-w-xl">
      <div className="space-y-2 mb-4">
        {schemes.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="input flex-1" value={s.name} onChange={(e) => setSchemes(schemes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="方案名称" />
            <select className="input w-28" value={s.type} onChange={(e) => setSchemes(schemes.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
              <option value="rate">折扣率</option>
              <option value="amount">减免</option>
            </select>
            <input className="input w-24" type="number" value={s.value} onChange={(e) => setSchemes(schemes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button className="btn-ghost text-red-500" onClick={() => setSchemes(schemes.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => setSchemes([...schemes, { id: Date.now(), name: '新方案', type: 'rate', value: '0.9' }])}>+ 添加方案</button>
        <button className="btn-primary" onClick={() => { for (const scheme of schemes) { const value = parseMoneyInput(scheme.value); if (!Number.isFinite(value) || value <= 0) { toast('折扣方案数值必须大于 0', 'error'); return } if (scheme.type === 'rate' && value > 1) { toast('折扣率须大于 0 且不超过 1（如 0.9 表示 9 折）', 'error'); return } } props.onSave(schemes.map((scheme) => ({ ...scheme, value: parseMoneyInput(scheme.value) }))) }}>保存方案</button>
      </div>
    </div>
  )
}

function CommissionTiersSettings(props: { tiers: any[]; onSave: (t: any[]) => void }): JSX.Element {
  const [tiers, setTiers] = useState<any[]>(props.tiers)
  useEffect(() => setTiers((props.tiers || []).map((t) => ({ ...t, min: String(t.min ?? ''), rate: String(t.rate ?? '') }))), [props.tiers])

  return (
    <div className="card p-5 max-w-xl">
      <div className="text-sm text-gray-500 mb-3">技师月度业绩达到门槛，提成按对应档比例计算（未配置阶梯时，用技师档案里的提成比例）</div>
      <div className="space-y-2 mb-4">
        {tiers.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-sm text-gray-500 w-16 shrink-0">业绩 ≥</span>
            <input className="input flex-1" type="number" min={0} value={t.min} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} placeholder="门槛金额(元)" />
            <span className="text-sm text-gray-500 shrink-0">提成</span>
            <input className="input w-24" type="number" min={0} value={t.rate} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} placeholder="%" />
            <span className="text-sm text-gray-500 shrink-0">%</span>
            <button className="btn-ghost text-red-500" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {tiers.length === 0 && <div className="text-xs text-gray-400 py-2">暂无阶梯档位，将使用技师档案里的单一提成比例</div>}
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => setTiers([...tiers, { min: '', rate: '' }])}>+ 添加档位</button>
        <button className="btn-primary" onClick={() => { for (const tier of tiers) { const min = parseMoneyInput(tier.min); const rate = parseMoneyInput(tier.rate); if (!Number.isFinite(rate) || rate <= 0 || rate > 100) { toast('提成档位比例必须大于 0', 'error'); return } if (!Number.isFinite(min) || min < 0) { toast('提成档位门槛金额请填写不小于 0 的数字', 'error'); return } } props.onSave([...tiers].map((tier) => ({ ...tier, min: parseMoneyInput(tier.min), rate: parseMoneyInput(tier.rate) })).sort((a, b) => a.min - b.min)) }}>保存阶梯</button>
      </div>
    </div>
  )
}

function PaySettings(props: { methods: string[]; onSave: (m: string[]) => void; qr?: Record<string, string>; onSaveAll?: (patch: Record<string, string>) => void }): JSX.Element {
  const [methods, setMethods] = useState<string[]>(props.methods)
  const [newMethod, setNewMethod] = useState('')
  const [qr, setQr] = useState<Record<string, string>>(props.qr || {})
  useEffect(() => { setMethods(props.methods); setQr(props.qr || {}) }, [props.methods, props.qr])

  const pickQr = (code: string): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      if (file.size > 400 * 1024) { toast('图片请小于 400KB（建议先用截图工具压缩）', 'error'); return }
      const reader = new FileReader()
      reader.onload = () => setQr((o) => ({ ...o, [code]: String(reader.result) }))
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const save = (): void => {
    const patch: Record<string, string> = { pay_methods: JSON.stringify(methods) }
    for (const [k, v] of Object.entries(qr)) patch[k] = v
    if (props.onSaveAll) props.onSaveAll(patch)
    else props.onSave(methods)
  }

  return (
    <div className="card p-5 max-w-xl">
      <div className="text-sm font-semibold text-gray-700 mb-2">启用的支付方式</div>
      <div className="flex flex-wrap gap-2 mb-4">
        {methods.map((m) => (
          <span key={m} className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 text-sm">
            {m}
            <button className="text-brand-400 hover:text-red-500" onClick={() => setMethods(methods.filter((x) => x !== m))}>✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 mb-4">
        <input className="input flex-1" value={newMethod} onChange={(e) => setNewMethod(e.target.value)} placeholder="新增支付方式名称" />
        <button className="btn-secondary" onClick={() => { if (newMethod && !methods.includes(newMethod)) { setMethods([...methods, newMethod]); setNewMethod('') } }}>添加</button>
      </div>

      {/* 收款码配置：收银台结账时可"出示收款码"给顾客扫码（试营业人工核销） */}
      <div className="border-t border-gray-100 pt-4 mb-4">
        <div className="text-sm font-semibold text-gray-700 mb-1">收款码（扫码收款）</div>
        <div className="text-xs text-gray-400 mb-3">上传后，收银台结账时点对应方式旁的「收款码」即可展示给顾客扫码付款（图片 ≤400KB，建议方形）。</div>
        <div className="grid grid-cols-2 gap-4">
          {(['微信', '支付宝'] as const).map((code) => (
            <div key={code} className="border border-gray-200 rounded-lg p-3 text-center">
              <div className="text-sm font-medium text-gray-700 mb-2">{code}收款码</div>
              {qr[`qr_${code}`] ? (
                <img src={qr[`qr_${code}`]} alt={`${code}收款码`} className="mx-auto w-28 h-28 object-contain rounded border border-gray-100" />
              ) : (
                <div className="mx-auto w-28 h-28 flex items-center justify-center rounded border border-dashed border-gray-300 text-[10px] text-gray-400">未上传</div>
              )}
              <div className="flex gap-2 mt-2 justify-center">
                <button className="btn-secondary !py-1 text-xs" onClick={() => pickQr(`qr_${code}`)}>上传</button>
                {qr[`qr_${code}`] && (
                  <button className="btn-ghost !py-1 text-xs text-red-500" onClick={() => setQr((o) => { const n = { ...o }; delete n[`qr_${code}`]; return n })}>移除</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button className="btn-primary" onClick={save}>保存支付方式</button>
    </div>
  )
}
