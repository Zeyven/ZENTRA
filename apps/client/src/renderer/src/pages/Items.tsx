import {canOperate} from '../utils/permissions'
import {usePageTab} from '../hooks/usePageTab'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Category, Item } from '../types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { fmtMoney, fmtNum, parseMoneyInput } from '../utils/format'
import { AsyncButton, Modal, Confirm, Badge, EmptyState } from '../components/ui'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { uuid } from '../utils/uuid'
import InventoryOrders from './InventoryOrders'

const emptyForm = {
  id: undefined as number | undefined,
  name: '',
  category_id: '' as number | '',
  type: 'service',
  price: '',
  duration: 60,
  commission: '20',
  stock: -1,
  low_stock_threshold: 10,
  cost: 0,
  unit: '份',
  sold_out: 0,
  is_primary: 1
}

export default function Items(): JSX.Element {
  const user = useAuth((s) => s.user)!
  const [items, setItems] = useState<Item[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [tab, setTab] = usePageTab<'service' | 'product' | 'inventory' | 'storage' | 'purchase' | 'transfer'>('service',['service','product','inventory','storage','purchase','transfer'])
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [delTarget, setDelTarget] = useState<Item | null>(null)
  const [movements, setMovements] = useState<any[]>([])
  const [showStock, setShowStock] = useState<Item | null>(null)
  const [stockQty, setStockQty] = useState(0)
  const [stockType, setStockType] = useState<'in' | 'out' | 'loss' | 'count'>('in')
  const [stockRemark, setStockRemark] = useState('')
  const [stockApprovalId, setStockApprovalId] = useState<number | null>(null)
  const [stockBusy, setStockBusy] = useState(false)
  const stockSubmitting = useRef(false)
  const stockRequestKey = useRef<string | null>(null)
  const [stockApprovals, setStockApprovals] = useState<any[]>([])
  useEffect(() => { stockRequestKey.current = null }, [showStock?.id, stockQty, stockType, stockRemark, stockApprovalId])
  const [inventoryOverview, setInventoryOverview] = useState<any>({ items: [], low_stock: [], summary: {} })
  // 酒水寄存
  const [storages, setStorages] = useState<any[]>([])
  const [showStorage, setShowStorage] = useState(false)
  const [storageForm, setStorageForm] = useState({ customer_name: '', phone: '', item_name: '', quantity: 1, remark: '' })
  // 服务耗材配方：服务结账时按标准用量自动扣减库存商品。
  const [recipeService, setRecipeService] = useState<Item | null>(null)
  const [recipeRows, setRecipeRows] = useState<{ product_item_id: number; qty: number }[]>([])
  const [recipeReason, setRecipeReason] = useState('')
  const [loadError,setLoadError]=useState('')
  const loadSequence=useRef(0)

  const load = useCallback(async () => {
    const sequence=++loadSequence.current
    if(tab==='purchase'||tab==='transfer')return
    try{const [it,c,data]=await Promise.all([api.listItems(),api.listCategories(),tab==='storage'?api.listWineStorage():tab==='inventory'?api.inventoryOverview():Promise.resolve(null)])
      if(sequence!==loadSequence.current)return
      setItems(it);setCats(c);if(tab==='storage')setStorages(data);if(tab==='inventory')setInventoryOverview(data);setLoadError('')
    }catch(error){if(sequence===loadSequence.current)setLoadError(error instanceof Error?error.message:'项目库存加载失败')}
  }, [tab])


  useAutoRefresh(load)

  const shown = items.filter((i) => i.type === tab && i.active!==0)
  const shownCats = cats.filter((c) => c.type === tab)

  const save = async (): Promise<void> => {
    if (!form.name) {
      toast('请填写名称', 'error')
      return
    }
    const price = parseMoneyInput(form.price)
    if (!Number.isFinite(price) || price <= 0) {
      toast('请填写有效售价（必须大于 0）', 'error')
      return
    }
    const commission = parseMoneyInput(form.commission)
    if (!Number.isFinite(commission) || commission < 0) {
      toast('项目提成请填写数字（0 表示不计提成）', 'error')
      return
    }
    if (form.type === 'service' && (!Number.isInteger(form.duration) || form.duration < 1)) {
      toast('服务项目时长必须大于 0 分钟', 'error')
      return
    }
    const payload = { ...form, price, commission, category_id: form.category_id || null }
    const res = await api.saveItem(payload, user.id)
    if (res.ok) {
      toast('已保存')
      setShowForm(false)
      await load()
    } else toast(res.msg||'保存失败','error')
  }

  const toggleSoldOut = async (it: Item): Promise<void> => {
    const res = await api.saveItem({ ...it, sold_out: it.sold_out ? 0 : 1 }, user.id)
    if (res.ok) {
      toast(it.sold_out ? `「${it.name}」已恢复销售` : `「${it.name}」已售罄`)
      await load()
    } else {
      toast(res.msg || '操作失败', 'error')
    }
  }

  const saveStorage = async (): Promise<void> => {
    if (!storageForm.customer_name || !storageForm.item_name || !(storageForm.quantity > 0)) {
      toast('请填写顾客名、寄存物品与数量', 'error')
      return
    }
    const res = await api.saveWineStorage(storageForm)
    if (res.ok) {
      toast('寄存成功')
      setShowStorage(false)
      setStorageForm({ customer_name: '', phone: '', item_name: '', quantity: 1, remark: '' })
      await load()
    } else {
      toast(res.msg || '保存失败', 'error')
    }
  }

  const openStock = async (it: Item, type: 'in' | 'out' | 'loss' | 'count' = 'in'): Promise<void> => {
    setShowStock(it)
    setStockType(type)
    setStockQty(type === 'count' ? it.stock : 0)
    setStockRemark('')
    setStockApprovalId(null)
    try {
      const [history, approvals] = await Promise.all([api.listInventory(), api.listApprovals('all')])
      setMovements(history)
      setStockApprovals(approvals.filter(a => {
        if (Number(a.requested_by) !== user.id || !['pending', 'approved'].includes(a.status) || a.action_type !== 'inventory_adjustment') return false
        try {
          const op = JSON.parse(a.after_snapshot)?.operation
          return (a.target_type === 'item' && Number(a.target_id) === it.id && ['in', 'out', 'loss'].includes(op?.type))
            || (a.target_type === 'inventory_count' && op?.type === 'count' && op.items?.length === 1 && Number(op.items[0].item_id) === it.id)
        } catch { return false }
      }))
    } catch { setShowStock(null); toast('读取库存记录和审批失败，请重试', 'error') }
  }

  const openRecipe = async (service: Item): Promise<void> => {
    try {
      const rows = await api.listServiceConsumables(service.id)
      setRecipeRows(rows.map((r) => ({ product_item_id: Number(r.product_item_id), qty: Number(r.qty) })))
      setRecipeReason('')
      setRecipeService(service)
    } catch {
      toast('读取耗材配方失败', 'error')
    }
  }

  const saveRecipe = async (): Promise<void> => {
    if (!recipeService) return
    if (recipeRows.some((r) => !r.product_item_id || !(r.qty > 0))) {
      toast('请正确选择耗材并填写用量', 'error')
      return
    }
    const res = await api.saveServiceConsumables(recipeService.id, recipeRows, recipeReason || undefined)
    if (res.ok) {
      toast('耗材配方已保存，后续结账将自动扣料')
      setRecipeService(null)
      await load()
    } else toast(res.msg || '保存失败', 'error')
  }

  const doStock = async (): Promise<void> => {
    if (stockSubmitting.current || !showStock) return
    if (!Number.isFinite(stockQty) || stockQty < 0 || (stockType !== 'count' && stockQty <= 0)) {
      toast('请填写有效数量', 'error'); return
    }
    if (!stockRemark.trim()) { toast('请填写调整原因', 'error'); return }
    stockSubmitting.current = true; setStockBusy(true)
    stockRequestKey.current ||= uuid()
    const requestMeta = { reason: stockRemark.trim(), idempotency_key: stockRequestKey.current,
      ...(stockApprovalId ? { approval_id: stockApprovalId } : {}) }
    try {
      const res = stockType === 'count'
        ? await api.stocktakeInventory({ items: [{ item_id: showStock.id, counted_qty: stockQty,expected_stock:showStock.stock }], remark: stockRemark.trim(), ...requestMeta }, user.id)
        : await api.moveInventory({ item_id: showStock.id, type: stockType, qty: stockQty,
          remark: stockRemark.trim(), ...requestMeta }, user.id) as any
      if (res.pending_approval) {
        setStockApprovalId(res.approval_id)
        toast('已提交审批，库存尚未改变'); return
      }
      if (res.ok) {
        toast(stockType === 'count' ? '盘点已完成' : '库存已更新')
        setShowStock(null); setStockApprovalId(null)
        await load()
      } else toast(res.msg || '操作失败', 'error')
    } catch {
      toast('未能确认操作结果，请先核对库存流水，不要直接重复提交', 'error')
    } finally {
      stockSubmitting.current = false; setStockBusy(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {loadError&&<p role="alert" className="bg-red-50 p-3 text-red-700">{loadError}；请刷新核对当前记录。</p>}
      <header className="items-toolbar bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-gray-800">项目 / 商品 / 库存</h2>
          <div className="items-tabs flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['service', 'product', 'inventory', 'purchase', 'transfer', 'storage'] as const).map((t) => (
              <button key={t} className={`px-4 py-1.5 rounded-md text-sm ${tab === t ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`} onClick={() => setTab(t)}>
                {t === 'service' ? '服务项目' : t === 'product' ? '商品酒水' : t === 'inventory' ? '库存盘点' : t === 'purchase' ? '采购收货' : t === 'transfer' ? '门店调拨' : '酒水寄存'}
              </button>
            ))}
          </div>
        </div>
        {tab === 'storage' ? (
          <button className="btn-primary" onClick={() => setShowStorage(true)} disabled={!canOperate(user,'inventoryManage')}>+ 登记寄存</button>
        ) : (tab === 'service' || tab === 'product') && (
          <button className="btn-primary" onClick={() => { setForm({ ...emptyForm, type: tab, duration: tab === 'service' ? 60 : 0, stock: tab === 'product' ? 0 : -1 }); setShowForm(true) }} disabled={!canOperate(user,'catalogManage')}>
            + 新增{tab === 'service' ? '项目' : '商品'}
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto px-5 py-4">
        {tab === 'purchase' || tab === 'transfer' ? <InventoryOrders key={tab} kind={tab}/> : tab === 'inventory' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="card p-4"><div className="text-xs text-gray-500">管理库存商品</div><div className="text-2xl font-bold">{inventoryOverview.summary?.managed_count || 0}</div></div>
              <div className="card p-4"><div className="text-xs text-gray-500">低库存预警</div><div className={`text-2xl font-bold ${(inventoryOverview.summary?.low_stock_count || 0) > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{inventoryOverview.summary?.low_stock_count || 0}</div></div>
              <div className="card p-4"><div className="text-xs text-gray-500">今日损耗数量</div><div className="text-2xl font-bold text-amber-600">{inventoryOverview.summary?.loss_qty_today || 0}</div></div>
              <div className="card p-4"><div className="text-xs text-gray-500">今日损耗成本</div><div className="text-2xl font-bold text-amber-600">{fmtMoney(inventoryOverview.summary?.loss_cost_today || 0)}</div></div>
            </div>
            {(inventoryOverview.low_stock || []).length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <b>低库存预警：</b>{inventoryOverview.low_stock.map((it: any) => `「${it.name}」剩余 ${it.stock}${it.unit}（预警线 ${it.low_stock_threshold}${it.unit}）`).join('；')}
              </div>
            )}
            <div className="card overflow-hidden">
              <table className="table w-full"><thead><tr><th>商品</th><th>当前库存</th><th>预警线</th><th>成本</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>{(inventoryOverview.items || []).map((it: any) => <tr key={it.id} className="hover:bg-gray-50"><td className="font-medium">{it.name}</td><td className={it.stock <= it.low_stock_threshold ? 'font-semibold text-red-500' : ''}>{it.stock} {it.unit}</td><td>{it.low_stock_threshold} {it.unit}</td><td>{fmtMoney(it.cost || 0)}</td><td>{it.stock <= it.low_stock_threshold ? <Badge text="需补货" className="bg-red-50 text-red-600" /> : <Badge text="正常" className="bg-emerald-50 text-emerald-600" />}</td><td><button className="text-xs text-brand-600 hover:underline" onClick={() => openStock(it, 'count')} disabled={!canOperate(user,'inventoryManage')}>盘点</button><button className="ml-2 text-xs text-amber-600 hover:underline" onClick={() => openStock(it, 'loss')} disabled={!canOperate(user,'inventoryManage')}>报损</button><button className="ml-2 text-xs text-sky-600 hover:underline" onClick={() => openStock(it, 'in')} disabled={!canOperate(user,'inventoryManage')}>入库</button></td></tr>)}</tbody>
              </table>
              {(inventoryOverview.items || []).length === 0 && <EmptyState text="暂无启用库存管理的商品，请在商品编辑中设置库存" />}
            </div>
          </div>
        ) : tab === 'storage' ? (
          <div className="card overflow-hidden">
            <table className="table w-full">
              <thead><tr><th>顾客</th><th>电话</th><th>寄存物品</th><th>数量</th><th>备注</th><th>登记时间</th><th>操作</th></tr></thead>
              <tbody>
                {storages.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="font-medium">{s.customer_name}</td>
                    <td>{s.phone || '-'}</td>
                    <td>{s.item_name}</td>
                    <td className="font-semibold">{s.quantity}</td>
                    <td className="text-gray-500">{s.remark || '-'}</td>
                    <td className="text-xs">{s.created_at}</td>
                    <td>
                      <button className="text-xs text-red-500 hover:underline" onClick={async () => { await api.deleteWineStorage(s.id); await load(); toast('已删除') }} disabled={!canOperate(user,'inventoryManage')}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {storages.length === 0 && <EmptyState text="暂无寄存记录（顾客寄存酒水/食品登记）" />}
          </div>
        ) : (
        <div className="card overflow-hidden">
          <table className="table w-full">
            <thead>
              <tr>
                <th>名称</th>
                <th>分类</th>
                {tab === 'service' ? <th>时长</th> : <th>库存</th>}
                {tab === 'product' && <th>预警线</th>}
                <th>售价</th>
                {tab === 'service' && <th>提成</th>}
                {tab === 'product' && <th>成本</th>}
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((it) => (
                <tr key={it.id} className={`hover:bg-gray-50 ${it.sold_out ? 'opacity-60' : ''}`}>
                  <td className="font-medium">
                    {it.name}
                    {tab === 'service' && (it.is_primary ? <Badge text="主项" className="bg-brand-50 text-brand-700 ml-1" /> : <Badge text="附项" className="bg-amber-50 text-amber-600 ml-1" />)}
                  </td>
                  <td>{it.category_name || '-'}</td>
                  {tab === 'service' ? (
                    <td>{it.duration > 0 ? `${it.duration}分钟` : '-'}</td>
                  ) : (
                    <td>
                      {it.stock < 0 ? <Badge text="不管理" className="bg-gray-100 text-gray-500" /> : <span className={it.stock <= 10 ? 'text-red-500 font-semibold' : ''}>{it.stock} {it.unit}</span>}
                    </td>
                  )}
                  {tab === 'product' && <td>{it.stock < 0 ? '-' : `${it.low_stock_threshold ?? 10} ${it.unit}`}</td>}
                  <td className="font-semibold text-brand-600">{fmtMoney(it.price)}</td>
                  {tab === 'service' && <td>{it.commission > 0 ? `¥${fmtNum(it.commission)}` : '-'}</td>}
                  {tab === 'product' && <td>{fmtNum(it.cost)}</td>}
                  <td>
                    {it.sold_out ? <Badge text="售罄" className="bg-red-50 text-red-500" /> : <Badge text="在售" className="bg-emerald-50 text-emerald-600" />}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => { setForm({ ...it, price: String(it.price ?? ''), commission: String(it.commission ?? 0), category_id: it.category_id ?? '', low_stock_threshold: it.low_stock_threshold ?? 10, sold_out: it.sold_out ? 1 : 0, is_primary: it.is_primary === 0 ? 0 : 1 }); setShowForm(true) }} disabled={!canOperate(user,'catalogManage')}>编辑</button>
                      <button className={`text-xs hover:underline ${it.sold_out ? 'text-emerald-600' : 'text-red-500'}`} onClick={() => toggleSoldOut(it)} disabled={!canOperate(user,'catalogManage')}>
                        {it.sold_out ? '恢复' : '售罄'}
                      </button>
                      {tab === 'service' && <button className="text-xs text-violet-600 hover:underline" onClick={() => openRecipe(it)} disabled={!canOperate(user,'inventoryManage')}>耗材配方</button>}
                      {tab === 'product' && it.stock >= 0 && <button className="text-xs text-sky-600 hover:underline" onClick={() => openStock(it)} disabled={!canOperate(user,'inventoryManage')}>库存</button>}
                      <button className="text-xs text-red-500 hover:underline" onClick={() => setDelTarget(it)} disabled={!canOperate(user,'catalogManage')}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <EmptyState text={`暂无${tab === 'service' ? '项目' : '商品'}`} />}
        </div>
        )}
      </div>

      {/* 表单 */}
      <Modal
        open={showForm}
        title={form.id ? '编辑' : '新增'}
        onClose={() => setShowForm(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>取消</button>
            <AsyncButton className="btn-primary" onClick={save} disabled={!canOperate(user,'catalogManage')}>保存</AsyncButton>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">名称 *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">分类</label>
            <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">未分类</option>
              {shownCats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">售价 *</label>
            <input className="input" type="number" min="0.01" step="0.01" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </div>
          {tab === 'service' ? (
            <>
              <div>
                <label className="label">时长(分钟)</label>
                <input className="input" type="number" min="0" step="1" value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">项目提成(元)</label>
                <input className="input" type="number" min="0" step="0.01" value={form.commission} onChange={(e) => setForm({ ...form, commission: e.target.value })} />
                <div className="text-xs text-gray-400 mt-1">0 表示按技师提成率计算</div>
              </div>
              <div className="col-span-2 flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-sm text-gray-600">
                  <input type="radio" className="accent-brand-500" checked={form.is_primary !== 0} onChange={() => setForm({ ...form, is_primary: 1 })} />
                  主项（核心项目，技师排钟计主项）
                </label>
                <label className="flex items-center gap-1.5 text-sm text-gray-600">
                  <input type="radio" className="accent-brand-500" checked={form.is_primary === 0} onChange={() => setForm({ ...form, is_primary: 0 })} />
                  附项（附加项目）
                </label>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">成本</label>
                <input className="input" type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">库存(-1不管理)</label>
                <input aria-label="商品库存" className="input" type="number" step="0.001" disabled={!!form.id} value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">低库存预警线</label>
                <input className="input" type="number" min={0} value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label">单位</label>
                <input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
              </div>
            </>
          )}
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" className="accent-brand-500" checked={form.sold_out === 1} onChange={(e) => setForm({ ...form, sold_out: e.target.checked ? 1 : 0 })} />
            <label className="text-sm text-gray-600">售罄/停售（点单时不可选择）</label>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!recipeService}
        title={`耗材配方：${recipeService?.name || ''}`}
        onClose={() => setRecipeService(null)}
        width="max-w-2xl"
        footer={<><button className="btn-secondary" onClick={() => setRecipeService(null)}>取消</button><AsyncButton className="btn-primary" onClick={saveRecipe}>保存配方</AsyncButton></>}
      >
        <p className="text-xs text-gray-500 mb-3">每完成并结账 1 次该服务，系统按下列标准用量自动扣减库存；反结账会自动退回。</p>
        <div className="space-y-2">
          {recipeRows.map((row, index) => (
            <div key={index} className="flex gap-2 items-center">
              <select className="input flex-1" value={row.product_item_id} onChange={(e) => setRecipeRows(recipeRows.map((x, i) => i === index ? { ...x, product_item_id: Number(e.target.value) } : x))}>
                <option value={0}>选择库存商品</option>
                {items.filter((x) => x.type === 'product' && x.stock >= 0).map((product) => <option key={product.id} value={product.id}>{product.name}（库存 {product.stock}{product.unit}）</option>)}
              </select>
              <input className="input w-28" type="number" min={0.01} step="0.01" value={row.qty} onChange={(e) => setRecipeRows(recipeRows.map((x, i) => i === index ? { ...x, qty: Number(e.target.value) } : x))} />
              <button className="text-xs text-red-500" onClick={() => setRecipeRows(recipeRows.filter((_, i) => i !== index))}>删除</button>
            </div>
          ))}
          <button className="text-sm text-brand-600 hover:underline" onClick={() => setRecipeRows([...recipeRows, { product_item_id: 0, qty: 1 }])}>+ 添加耗材</button>
        </div>
        <div className="mt-4"><label className="label">修改原因（建议填写）</label><input className="input" value={recipeReason} onChange={(e) => setRecipeReason(e.target.value)} placeholder="如：更新标准足浴包用量" /></div>
      </Modal>

      {/* 库存弹窗 */}
      <Modal
        open={!!showStock}
        title={`库存管理：${showStock?.name || ''}`}
        onClose={() => setShowStock(null)}
        width="max-w-2xl"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowStock(null)}>关闭</button>
            <button className="btn-primary" disabled={stockBusy} onClick={doStock}>{stockBusy ? '提交中…' : stockApprovalId ? '审批后执行' : '确认'}</button>
          </>
        }
      >
        {stockApprovalId && <p role="status" className="mb-3 text-sm text-amber-700">审批单 #{stockApprovalId}：库存尚未改变。请由另一位有审核权限的账号在审批中心审核，再点击“审批后执行”。</p>}
        {!stockApprovalId && stockApprovals.length > 0 && <select className="input mb-3" aria-label="继续已有审批" value="" onChange={e => {
          const approval = stockApprovals.find(a => String(a.id) === e.target.value)
          if (!approval) return
          const operation = JSON.parse(approval.after_snapshot).operation
          setStockType(operation.type); setStockQty(operation.type === 'count' ? operation.items[0].actual_qty : operation.qty)
          setStockRemark(approval.reason); setStockApprovalId(approval.id)
        }}><option value="">继续已有审批（或填写新操作）</option>{stockApprovals.map(a => <option key={a.id} value={a.id}>#{a.id} · {a.status === 'approved' ? '已批准' : '待审核'} · {a.reason}</option>)}</select>}
        <fieldset disabled={stockBusy || stockApprovalId !== null}>
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm text-gray-500">当前库存：<b className="text-gray-800">{showStock?.stock}</b> {showStock?.unit}</span>
          <div className="flex gap-2 flex-wrap">
            <button className={`px-3 py-1.5 rounded-lg text-sm ${stockType === 'in' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`} onClick={() => setStockType('in')}>入库</button>
            <button className={`px-3 py-1.5 rounded-lg text-sm ${stockType === 'out' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`} onClick={() => setStockType('out')}>出库</button>
            <button className={`px-3 py-1.5 rounded-lg text-sm ${stockType === 'loss' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'}`} onClick={() => setStockType('loss')}>报损</button>
            <button className={`px-3 py-1.5 rounded-lg text-sm ${stockType === 'count' ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`} onClick={() => { setStockType('count'); setStockQty(showStock?.stock || 0) }}>盘点</button>
          </div>
          <input aria-label="库存操作数量" className="input w-28" type="number" min={0} value={stockQty} onChange={(e) => setStockQty(Number(e.target.value))} placeholder={stockType === 'count' ? '实盘数量' : '数量'} />
        </div>
        <input aria-label="库存操作原因" className="input mb-4" value={stockRemark} onChange={(e) => setStockRemark(e.target.value)} placeholder={stockType === 'loss' ? '损耗原因（如破损/过期）' : '调整原因（必填）'} />
        </fieldset>
        <div className="text-xs font-medium text-gray-500 mb-2">出入库记录</div>
        <div className="max-h-64 overflow-y-auto">
          <table className="table w-full">
            <thead><tr><th>时间</th><th>类型</th><th>数量</th><th>备注</th></tr></thead>
            <tbody>
              {movements.filter((m) => m.item_id === showStock?.id).slice(0, 50).map((m) => (
                <tr key={m.id}>
                  <td>{m.created_at}</td>
                  <td>{m.type === 'in' ? <Badge text="入库" className="bg-emerald-50 text-emerald-600" /> : m.type === 'out' ? <Badge text="出库" className="bg-sky-50 text-sky-600" /> : m.type === 'loss' ? <Badge text="报损" className="bg-amber-50 text-amber-600" /> : <Badge text="盘点差异" className="bg-violet-50 text-violet-600" />}</td>
                  <td>{m.type === 'count' && m.qty > 0 ? '+' : ''}{m.qty}</td>
                  <td>{m.remark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* 酒水寄存登记 */}
      <Modal
        open={showStorage}
        title="登记酒水寄存"
        onClose={() => setShowStorage(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowStorage(false)}>取消</button>
            <AsyncButton className="btn-primary" onClick={saveStorage}>确认寄存</AsyncButton>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">顾客姓名 *</label>
            <input className="input" value={storageForm.customer_name} onChange={(e) => setStorageForm({ ...storageForm, customer_name: e.target.value })} />
          </div>
          <div>
            <label className="label">电话</label>
            <input className="input" value={storageForm.phone} onChange={(e) => setStorageForm({ ...storageForm, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">寄存物品 *</label>
            <input className="input" value={storageForm.item_name} onChange={(e) => setStorageForm({ ...storageForm, item_name: e.target.value })} placeholder="如：红酒/茅台" />
          </div>
          <div>
            <label className="label">数量 *</label>
            <input className="input" type="number" min={0.1} step={0.1} value={storageForm.quantity} onChange={(e) => setStorageForm({ ...storageForm, quantity: Number(e.target.value) })} />
          </div>
          <div className="col-span-2">
            <label className="label">备注</label>
            <input className="input" value={storageForm.remark} onChange={(e) => setStorageForm({ ...storageForm, remark: e.target.value })} placeholder="如：未开封/寄存房间" />
          </div>
        </div>
      </Modal>

      <Confirm
        open={!!delTarget}
        title="删除"
        message={`确认删除「${delTarget?.name}」？`}
        onCancel={() => setDelTarget(null)}
        onConfirm={async () => {
          if (delTarget) {
            const res = await api.deleteItem(delTarget.id, user.id)
            if (res.ok) toast('已删除')
            else toast(res.msg || '删除失败', 'error')
          }
          setDelTarget(null)
          await load()
        }}
      />
    </div>
  )
}
