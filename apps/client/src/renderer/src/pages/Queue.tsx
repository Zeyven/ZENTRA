import {canOperate} from '../utils/permissions'
import { useCallback, useEffect, useRef,useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../api'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { fmtTime } from '../utils/format'
import { Modal, Badge, EmptyState,AsyncButton } from '../components/ui'
import {getServerUrl} from '../api/transport'
import { useAutoRefresh } from '../hooks/useAutoRefresh'

interface QueueItem {
  id: number
  version:number
  queue_no: string
  customer_name?: string | null
  people: number
  phone?: string | null
  status: string
  created_at?: string
  called_at?: string
}

const STATUS_TABS = [
  { k: 'waiting', label: '等待中' },
  { k: 'called', label: '已叫号' },
  { k: 'done', label: '已入座' },
  { k: 'cancelled', label: '已取消' },
  { k: 'all', label: '全部' }
]

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  waiting: { label: '等待中', cls: 'bg-amber-50 text-amber-600' },
  called: { label: '已叫号', cls: 'bg-sky-50 text-sky-600' },
  done: { label: '已入座', cls: 'bg-emerald-50 text-emerald-600' },
  cancelled: { label: '已取消', cls: 'bg-gray-100 text-gray-500' }
}

export default function Queue(): JSX.Element {
  const user = useAuth((s) => s.user)!
  const [list, setList] = useState<QueueItem[]>([])
  const [status, setStatus] = useState('waiting')
  const [showTake, setShowTake] = useState(false)
  const [form, setForm] = useState({ customer_name: '', people: 1, phone: '' })
  const [qrUrl, setQrUrl] = useState('')
  const [summary,setSummary]=useState({waiting_count:0,waiting_people:0,called_no:null as string|null})
  const [loadError,setLoadError]=useState('')
  const loadSequence=useRef(0)

  // 生成扫码取号二维码（顾客手机扫码 → 自助取号页）
  useEffect(() => {
    const auth=useAuth.getState(),store=auth.stores.find(s=>s.id===auth.currentStoreId)
    if(!auth.merchant||!store)return
    const takeUrl = `${getServerUrl()}/customer/${encodeURIComponent(auth.merchant.code)}/${encodeURIComponent(store.code)}/queue`
    QRCode.toDataURL(takeUrl, { width: 150, margin: 1 })
      .then(setQrUrl)
      .catch(() => setLoadError('顾客入口二维码生成失败'))
  }, [])

  const load = useCallback(async () => {
    const sequence=++loadSequence.current
    try{const [rows,stats]=await Promise.all([api.listQueue(status === 'all' ? undefined : status),api.queueSummary()]);if(sequence===loadSequence.current){setList(rows);setSummary(stats);setLoadError('')}}catch(error){if(sequence===loadSequence.current)setLoadError(error instanceof Error?error.message:'排队加载失败')}
  }, [status])


  useAutoRefresh(load, 10000)

  const take = async (): Promise<void> => {
    if (!form.customer_name) {
      toast('请填写顾客姓名', 'error')
      return
    }
    const res = await api.takeQueue(form, user.id)
    if (res.ok) {
      toast(`取号成功 ${res.queue?.queue_no}`)
      setShowTake(false)
      setForm({ customer_name: '', people: 1, phone: '' })
      await load()
    } else toast(res.msg || '取号失败', 'error')
  }

  const call = async (q: QueueItem): Promise<void> => {
    const res = await api.callQueue(q.id, user.id,q.version)
    if (res.ok) toast(`叫号 ${q.queue_no}`)
    else toast(res.msg || '操作失败', 'error')
    await load()
  }

  const done = async (q: QueueItem): Promise<void> => {
    const res = await api.doneQueue(q.id, user.id,q.version)
    if (res.ok) toast(`${q.queue_no} 已入座`)
    else toast(res.msg || '操作失败', 'error')
    await load()
  }

  const cancel = async (q: QueueItem): Promise<void> => {
    const res = await api.cancelQueue(q.id, user.id,q.version)
    if (res.ok) toast(`${q.queue_no} 已取消`)
    else toast(res.msg || '操作失败', 'error')
    await load()
  }

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <h2 className="text-lg font-bold text-gray-800">排队叫号</h2>
        <button className="btn-primary" onClick={() => setShowTake(true)} disabled={!canOperate(user,'queueManage')}>+ 取号</button>
      </header>

      {/* 叫号大屏 + 扫码排队 */}
      <div className="px-5 py-4 flex gap-4 shrink-0">
        <div className="flex-1 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white p-5 flex items-center justify-between">
          <div>
            <div className="text-sm opacity-80">当前叫号</div>
            <div className="text-4xl font-bold mt-1">{summary.called_no || '—'}</div>
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold">{summary.waiting_count}</div>
            <div className="text-sm opacity-80">组等待 · 共 {summary.waiting_people} 人</div>
          </div>
        </div>
        <div className="w-48 shrink-0 rounded-xl bg-white border border-gray-200 p-3 flex flex-col items-center justify-center">
          {qrUrl ? (
            <>
              <img src={qrUrl} alt="扫码排队" className="w-28 h-28" />
              <div className="text-xs text-gray-500 mt-2 text-center">顾客扫码自助取号<br />（免登录）</div>
            </>
          ) : (
            <div className="text-xs text-gray-400">生成中...</div>
          )}
        </div>
      </div>

      {/* 状态 tab */}
      <div className="px-5 pb-3 flex gap-2 shrink-0">
        {STATUS_TABS.map((s) => (
          <button
            key={s.k}
            className={`px-4 py-1.5 rounded-full text-sm ${status === s.k ? 'bg-brand-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}
            onClick={() => setStatus(s.k)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 排队列表 */}
      <div className="flex-1 overflow-auto px-5 pb-5">
        {loadError&&<p role="alert" className="mb-3 text-red-600">{loadError}；请刷新核对。</p>}
        <div className="card overflow-hidden">
          <table className="table w-full">
            <thead>
              <tr>
                <th>排号</th>
                <th>姓名</th>
                <th>人数</th>
                <th>电话</th>
                <th>取号时间</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="font-mono text-base font-bold text-brand-600">{q.queue_no}</td>
                  <td className="font-medium">{q.customer_name || '-'}</td>
                  <td>{q.people}位</td>
                  <td>{q.phone || '-'}</td>
                  <td>{fmtTime(q.created_at)}</td>
                  <td><Badge text={STATUS_BADGE[q.status]?.label || q.status} className={STATUS_BADGE[q.status]?.cls || ''} /></td>
                  <td>
                    <div className="flex gap-2">
                      {q.status === 'waiting' && (
                        <>
                          <AsyncButton className="text-xs text-brand-600 hover:underline" onClick={() => call(q)} disabled={!canOperate(user,'queueManage')}>叫号</AsyncButton>
                          <AsyncButton className="text-xs text-emerald-600 hover:underline" onClick={() => done(q)} disabled={!canOperate(user,'queueManage')}>入座</AsyncButton>
                          <AsyncButton className="text-xs text-gray-500 hover:underline" onClick={() => cancel(q)} disabled={!canOperate(user,'queueManage')}>取消</AsyncButton>
                        </>
                      )}
                      {q.status === 'called' && (
                        <>
                          <AsyncButton className="text-xs text-brand-600 hover:underline" onClick={() => call(q)} disabled={!canOperate(user,'queueManage')}>重叫</AsyncButton>
                          <AsyncButton className="text-xs text-emerald-600 hover:underline" onClick={() => done(q)} disabled={!canOperate(user,'queueManage')}>入座</AsyncButton>
                          <AsyncButton className="text-xs text-gray-500 hover:underline" onClick={() => cancel(q)} disabled={!canOperate(user,'queueManage')}>过号</AsyncButton>
                        </>
                      )}
                      {(q.status === 'done' || q.status === 'cancelled') && <span className="text-xs text-gray-400">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <EmptyState text="暂无排队" />}
        </div>
      </div>

      {/* 取号弹窗 */}
      <Modal
        open={showTake}
        title="排队取号"
        onClose={() => setShowTake(false)}
        width="max-w-sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowTake(false)}>取消</button>
            <AsyncButton className="btn-primary" onClick={take} disabled={!canOperate(user,'queueManage')}>确认取号</AsyncButton>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">顾客姓名 *</label>
            <input className="input" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="必填" />
          </div>
          <div>
            <label className="label">人数</label>
            <input className="input" type="number" min={1} value={form.people} onChange={(e) => setForm({ ...form, people: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">电话</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="选填" />
          </div>
        </div>
      </Modal>
    </div>
  )
}
