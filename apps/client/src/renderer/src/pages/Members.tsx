import {canOperate} from '../utils/permissions'
import {usePageTab} from '../hooks/usePageTab'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Member } from '../types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { fmtMoney, fmtDateTime, CARD_TYPES, maskPhone, parseMoneyInput } from '../utils/format'
import { AsyncButton, Modal, Confirm, Badge, EmptyState } from '../components/ui'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { can } from '../utils/permissions'
import MemberAssets from '../components/MemberAssets'
import CouponCampaigns from '../components/CouponCampaigns'
import MemberWake from '../components/MemberWake'
import {rechargeJournalKey,readRechargeJournal,saveRechargeJournal,clearRechargeJournal} from '../api/recharge-journal'

const emptyForm = {
  id: undefined as number | undefined,
  name: '',
  phone: '',
  card_no: '',
  card_type: 'storage',
  balance: '0',
  times_balance: '0',
  discount: '1',
  salesman: '',
  tags: '',
  level: '普通会员',
  birthday: '',
  expiry: ''
}

type Tab = 'list' | 'analysis' | 'segments' | 'claims'

export default function Members(): JSX.Element {
  const user = useAuth((s) => s.user)!
  const management=['owner','manager','support'].includes(user.role)
  const canChangeBenefits=['owner','manager'].includes(user.role)&&can(user,'discount')
  const [tab, setTab] = usePageTab<Tab>('list',management?['list','analysis','segments','claims']:['list'])
  const [list, setList] = useState<Member[]>([])
  const [kw, setKw] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [delTarget, setDelTarget] = useState<Member | null>(null)
  const [levels, setLevels] = useState<any[]>([])
  const [plans, setPlans] = useState<any[]>([])

  // 充值
  const [rechargeTarget, setRechargeTarget] = useState<Member | null>(null)
  const [rechargeMethod,setRechargeMethod]=useState('现金')
  const [recharge, setRecharge] = useState({ amount: 0, bonus: 0, times: 0, plan_id: undefined as number | undefined })
  const rechargePending = useRef<{ signature: string; key: string } | null>(null)
  const rechargeBusy = useRef(false)
  const [recharging, setRecharging] = useState(false)
  const [rechargeUnknown, setRechargeUnknown] = useState(false)
  const [rechargeError, setRechargeError] = useState('')
  const [rechargeRecoveryError,setRechargeRecoveryError]=useState('')
  const [loadError, setLoadError] = useState('')
  const [configError, setConfigError] = useState('')
  const loadSequence = useRef(0)
  // 详情
  const [detail, setDetail] = useState<any>(null)
  // 优惠券
  const [memberCoupons, setMemberCoupons] = useState<any[]>([])
  const [showIssueCoupon, setShowIssueCoupon] = useState(false)
  const [couponProfiles,setCouponProfiles]=useState<any[]>([])
  const [couponProfileId,setCouponProfileId]=useState<number|null>(null)
  const couponBusy=useRef(false)
  const [couponForm, setCouponForm] = useState({ name: '', type: 'cash', value: 0, min_amount: 0, expire_at: '' })
  // 分析/分群
  const [analysis, setAnalysis] = useState<any>(null)
  const [segments, setSegments] = useState<any>(null)
  const [exchangePts, setExchangePts] = useState(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    if (tab === 'claims') return
    try {
      // Each tab loads independently, including a direct entry into segmentation.
      const result = tab === 'list' ? await api.listMembers(kw) : tab === 'analysis' ? await api.memberAnalysis() : await api.memberSegments()
      if (sequence !== loadSequence.current) return
      if (tab === 'list') setList(result)
      else if (tab === 'analysis') setAnalysis(result)
      else setSegments(result)
      setLoadError('')
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(error instanceof Error ? error.message : '会员数据加载失败')
    }
  }, [kw, tab])

  useEffect(() => {
    api.listMemberLevels().then(setLevels).catch(() => setConfigError('会员等级/充值方案加载失败，请刷新重试'))
    api.listRechargePlans().then(setPlans).catch(() => setConfigError('会员等级/充值方案加载失败，请刷新重试'))
  }, [])

  useAutoRefresh(load)

  useEffect(()=>{
    let active=true
    try{const record=readRechargeJournal(rechargeJournalKey());if(record){
      rechargePending.current={signature:record.signature,key:record.key};setRechargeUnknown(true)
      setRecharge({...record.recharge,plan_id:record.recharge.plan_id});setRechargeMethod(record.method)
      void api.getMember(record.memberId).then(result=>{if(active){setRechargeTarget(result.member);setRechargeError('已恢复上次未确认的充值，请核对原请求，勿再次收款')}}).catch(()=>{if(active)setRechargeRecoveryError('待核对充值的会员资料读取失败，请刷新页面重试；原请求已保留')})
    }}catch(e){setRechargeUnknown(true);setRechargeRecoveryError(e instanceof Error?e.message:'无法读取充值恢复记录')}
    return()=>{active=false}
  },[])

  const save = async (): Promise<void> => {
    if (!form.name) {
      toast('请填写姓名', 'error')
      return
    }
    const discount = parseMoneyInput(form.discount)
    if (!Number.isFinite(discount) || discount <= 0 || discount > 1) {
      toast('折扣必须大于 0', 'error')
      return
    }
    const balance = parseMoneyInput(form.balance)
    const timesBalance = parseMoneyInput(form.times_balance)
    if (!form.id) {
      if (form.card_type === 'storage' && can(user, 'adjust') && !Number.isFinite(balance)) {
        toast('请填写初始储值金额', 'error')
        return
      }
      if (form.card_type === 'times' && can(user, 'adjust') && !Number.isFinite(timesBalance)) {
        toast('请填写初始次数', 'error')
        return
      }
    }
    const numeric = { ...form, discount, balance: Number.isFinite(balance) ? balance : 0, times_balance: Number.isFinite(timesBalance) ? timesBalance : 0 }
    // Profile editing must not replay stale balances over another terminal's recharge.
    const payload = form.id ? { ...numeric, balance: undefined, times_balance: undefined } : numeric
    const res = await api.saveMember(payload, user.id)
    if (res.ok) {
      toast('已保存')
      setShowForm(false)
      await load()
    } else {
      toast(res.msg || '保存失败', 'error')
    }
  }

  const doRecharge = async (): Promise<void> => {
    if (!rechargeTarget || rechargeBusy.current) return
    if (![recharge.amount, recharge.bonus, recharge.times].every(v => Number.isFinite(v) && v >= 0) || !Number.isSafeInteger(recharge.times)) {
      toast('金额不能为负数，次数必须为非负整数', 'error'); return
    }
    if (recharge.amount <= 0) {
      toast('请输入本次实际收款金额；赠送权益请使用权益调整', 'error')
      return
    }
    const signature = JSON.stringify([rechargeTarget.id, recharge, rechargeMethod])
    if (rechargePending.current && rechargePending.current.signature !== signature) {setRechargeError('原充值尚未核对，请勿改变金额或另开充值');return}
    if (!rechargePending.current) rechargePending.current = { signature, key: crypto.randomUUID() }
    rechargeBusy.current = true
    setRecharging(true)
    setRechargeError('')
    let sent=false
    let journalScope='';const requestKey=rechargePending.current.key
    try {
    journalScope=rechargeJournalKey()
    await saveRechargeJournal(journalScope,{version:1,memberId:rechargeTarget.id,recharge,method:rechargeMethod,key:requestKey,signature})
    sent=true
    const res = await api.rechargeMember(
      { member_id: rechargeTarget.id, amount: recharge.amount, bonus: recharge.bonus, times: recharge.times, plan_id: recharge.plan_id, method:rechargeMethod,idempotency_key: rechargePending.current.key },
      user.id
    )
    if (res.ok) {
      clearRechargeJournal(journalScope,requestKey)
      rechargePending.current = null
      setRechargeUnknown(false)
      toast('充值成功')
      setRechargeTarget(null)
      // Use the committed account; shared invalidation already refreshes the list.
      setList(previous => previous.map(member => member.id === res.member.id && (member.asset_version ?? 0) <= res.member.asset_version ? { ...member, ...res.member } : member))
    } else {
      const unknown = res.code === 'RESULT_UNKNOWN'
      setRechargeUnknown(unknown)
      if(!unknown){clearRechargeJournal(journalScope,requestKey);rechargePending.current = null}
      setRechargeError(res.msg || '充值失败')
    }
    } catch (e) { if(!sent)rechargePending.current=null;setRechargeUnknown(sent||rechargeUnknown); setRechargeError(sent?'充值结果未确认，请核对原请求，勿重复收款':e instanceof Error?e.message:'未发送充值：本机无法保存恢复记录') }
    finally { rechargeBusy.current = false; setRecharging(false) }
  }

  const onPickPlan = (planId: number): void => {
    if (!planId) { setRecharge({ ...recharge, plan_id: undefined }); return }
    const p = plans.find((x) => x.id === planId)
    if (p) setRecharge({ ...recharge, plan_id: planId, amount: Number(p.amount) || 0, bonus: Number(p.gift_amount) || 0 })
  }

  const openDetail = async (m: Member): Promise<void> => {
    const next=await api.getMember(m.id);setDetail(next);setMemberCoupons(next.coupons)
    setExchangePts(0)
  }

  const doExchangePoints = async (): Promise<void> => {
    if (!detail) return
    if (!(exchangePts > 0)) {
      toast('请输入兑换积分数', 'error')
      return
    }
    const res = await api.exchangePoints(detail.member.id, exchangePts, '积分兑换')
    if (res.ok) {
      toast('积分兑换成功')
      await openDetail(detail.member)
    } else {
      toast(res.msg || '兑换失败', 'error')
    }
  }

  const issueCoupon = async (): Promise<void> => {
    if(couponBusy.current||!detail?.member?.id)return
    couponBusy.current=true
    try{
    if(couponProfileId){await api.issueCouponProfile(couponProfileId,detail.member.id);setShowIssueCoupon(false);setCouponProfileId(null);toast('发券成功');setMemberCoupons(await api.listCoupons({member_id:detail.member.id}));return}
    if (!couponForm.name.trim() || !Number.isFinite(couponForm.value) || !(couponForm.value > 0)) {
      toast('请填写券名和面值', 'error')
      return
    }
    if ((couponForm.type === 'discount' && couponForm.value > 1) || !Number.isFinite(couponForm.min_amount) || couponForm.min_amount < 0) {
      toast('折扣率须大于 0 且不超过 1，门槛不能为负数', 'error'); return
    }
    const res = await api.issueCoupon(
      {
        member_id: detail?.member?.id ?? null,
        name: couponForm.name,
        type: couponForm.type,
        value: couponForm.value,
        min_amount: couponForm.min_amount,
        expire_at: couponForm.expire_at || null
      },
      user.id
    )
    if (res.ok) {
      toast('发券成功')
      setShowIssueCoupon(false)
      setCouponForm({ name: '', type: 'cash', value: 0, min_amount: 0, expire_at: '' })
      if (detail) setMemberCoupons(await api.listCoupons({ member_id: detail.member.id }))
    } else toast(res.msg || '发券失败', 'error')
    }finally{couponBusy.current=false}
  }

  const setStatus = async (m: Member, status: string): Promise<void> => {
    const res = await api.setMemberStatus({ member_id: m.id, status }, user.id)
    if (res.ok) toast(status === 'active' ? '已启用' : '已冻结')
    else toast(res.msg || '操作失败', 'error')
    await load()
  }

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-gray-800">会员管理</h2>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button className={`px-3 py-1.5 rounded-md text-sm ${tab === 'list' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`} onClick={() => setTab('list')}>会员列表</button>
            {management&&<button className={`px-3 py-1.5 rounded-md text-sm ${tab === 'analysis' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`} onClick={() => setTab('analysis')}>异常分析</button>}
            {management&&<button className={`px-3 py-1.5 rounded-md text-sm ${tab === 'segments' ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`} onClick={() => setTab('segments')}>智能分群</button>}
            {['owner','manager'].includes(user.role)&&can(user,'discount')&&<button className={`px-3 py-1.5 rounded-md text-sm ${tab==='claims'?'bg-white shadow text-gray-800':'text-gray-500'}`} onClick={()=>setTab('claims')}>到店领券</button>}
          </div>
        </div>
        {tab === 'list' && (
          <div className="flex gap-2">
            <input className="input w-56" placeholder="搜索姓名/手机号/卡号" value={kw} onChange={(e) => setKw(e.target.value)} />
            <button className="btn-primary" onClick={() => { setForm(emptyForm); setShowForm(true) }} disabled={!canOperate(user,'memberManage')}>+ 开卡</button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto px-5 py-4">
        {rechargeRecoveryError&&<p role="alert" className="mb-3 text-red-600">{rechargeRecoveryError}</p>}
        {tab === 'claims' && <CouponCampaigns manage={false}/>}
        {loadError && <div role="alert" className="mb-3 text-red-600">{loadError}；当前内容可能不是最新数据。<button className="btn-secondary ml-2" onClick={load}>重新加载</button></div>}
        {configError && <div role="alert" className="mb-3 text-red-600">{configError}</div>}
        {tab === 'list' && (
          <div className="card overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>卡号</th>
                  <th>姓名</th>
                  <th>等级</th>
                  <th>电话</th>
                  <th>卡类型</th>
                  <th>余额</th>
                  <th>赠金</th>
                  <th>次卡</th>
                  <th>积分</th>
                  <th>标签</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="font-mono text-xs">{m.card_no || '-'}</td>
                    <td className="font-medium">{m.name}</td>
                    <td><Badge text={m.level || '普通会员'} className="bg-amber-50 text-amber-600" /></td>
                    <td>{maskPhone(m.phone)}</td>
                    <td><Badge text={CARD_TYPES[m.card_type]} className="bg-brand-50 text-brand-700" /></td>
                    <td className="font-semibold text-gray-800">{fmtMoney(m.balance)}</td>
                    <td>{fmtMoney(m.bonus_balance)}</td>
                    <td>{m.times_balance > 0 ? `${m.times_balance}次` : '-'}</td>
                    <td className="text-violet-600 font-semibold">{m.points || 0}</td>
                    <td>{(m.tags || '').split(',').filter(Boolean).map((t) => <Badge key={t} text={t} className="bg-violet-50 text-violet-600 mr-1" />)}</td>
                    <td>
                      {m.status === 'active' ? <Badge text="正常" className="bg-emerald-50 text-emerald-600" /> : m.status === 'frozen' ? <Badge text="冻结" className="bg-sky-50 text-sky-600" /> : <Badge text={m.status} className="bg-gray-100 text-gray-500" />}
                    </td>
                    <td>
                      <div className="flex gap-1.5">
                        <button className="text-xs text-brand-600 hover:underline" disabled={!can(user,'recharge')||rechargeUnknown||recharging} onClick={() => { setRechargeTarget(m); setRechargeError(''); setRecharge({ amount: 0, bonus: 0, times: 0, plan_id: undefined }) }}>充值</button>
                        <button className="text-xs text-gray-600 hover:underline" onClick={() => openDetail(m)}>详情</button>
                        <button className="text-xs text-gray-600 hover:underline" onClick={() => { setForm({ id: m.id, name: m.name, phone: m.phone ?? '', card_no: m.card_no ?? '', card_type: m.card_type, balance: String(m.balance ?? 0), times_balance: String(m.times_balance ?? 0), discount: String(m.discount ?? 1), salesman: m.salesman ?? '', tags: m.tags ?? '', level: m.level || '普通会员', birthday: m.birthday || '', expiry: m.expiry || '' }); setShowForm(true) }} disabled={!canOperate(user,'memberManage')}>编辑</button>
                        <button className="text-xs text-sky-600 hover:underline" onClick={() => setStatus(m, m.status === 'active' ? 'frozen' : 'active')} disabled={!canOperate(user,'memberManage')||!['owner','manager'].includes(user.role)}>
                          {m.status === 'active' ? '冻结' : '启用'}
                        </button>
                        <button className="text-xs text-red-500 hover:underline" onClick={() => setDelTarget(m)} disabled={!canOperate(user,'memberManage')||!['owner','manager'].includes(user.role)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length === 0 && <EmptyState text="暂无会员" />}
          </div>
        )}

        {tab === 'analysis' && (
          <div className="space-y-4">
            {!analysis ? (
              <EmptyState text={loadError ? '数据未能加载' : '加载中...'} />
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="card p-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">🔁 高频退单（近30天≥3次）</div>
                    {analysis.high_refund.length === 0 ? <div className="text-xs text-gray-400">无异常</div> : (
                      analysis.high_refund.map((m: any) => <div key={m.id} className="text-xs py-0.5">{m.name}（{m.refund_cnt}次）</div>)
                    )}
                  </div>
                  <div className="card p-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">😴 沉睡会员（90天未消费）</div>
                    {analysis.long_idle.length === 0 ? <div className="text-xs text-gray-400">无异常</div> : (
                      analysis.long_idle.slice(0, 6).map((m: any) => <div key={m.id} className="text-xs py-0.5">{m.name}（余额{m.balance > 0 ? fmtMoney(m.balance) : `${m.times_balance}次`}）</div>)
                    )}
                  </div>
                  <div className="card p-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">💰 高余额沉睡（≥500）</div>
                    {analysis.high_balance_idle.length === 0 ? <div className="text-xs text-gray-400">无异常</div> : (
                      analysis.high_balance_idle.slice(0, 6).map((m: any) => <div key={m.id} className="text-xs py-0.5">{m.name}（{fmtMoney(m.balance)}）</div>)
                    )}
                  </div>
                  <div className="card p-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">🌙 凌晨消费（1-5点≥3次）</div>
                    {analysis.abnormal_hours.length === 0 ? <div className="text-xs text-gray-400">无异常</div> : (
                      analysis.abnormal_hours.map((m: any) => <div key={m.id} className="text-xs py-0.5">{m.name}（{m.cnt}次）</div>)
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'segments' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {['owner','manager'].includes(user.role)&&can(user,'discount')&&<div className="col-span-full"><MemberWake/></div>}
            {!segments ? (
              <EmptyState text={loadError ? '数据未能加载' : '加载中...'} />
            ) : (
              (['high_value', 'active', 'sleeping', 'new_customer'] as const).map((key) => {
                const title = key === 'high_value' ? '⭐ 高价值' : key === 'active' ? '🔥 活跃' : key === 'sleeping' ? '😴 沉睡' : '🆕 新客'
                const list = segments[key] || []
                return (
                  <div key={key} className="card p-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">{title}（{list.length}）</div>
                    {list.length === 0 ? <div className="text-xs text-gray-400">无</div> : (
                      list.slice(0, 10).map((m: any) => (
                        <div key={m.id} className="text-xs py-0.5 flex justify-between">
                          <span>{m.name}</span>
                          <span className="text-gray-400">{m.total_consume ? fmtMoney(m.total_consume) : fmtMoney(m.balance)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* 开卡/编辑 */}
      <Modal
        open={showForm}
        title={form.id ? '编辑会员' : '会员开卡'}
        onClose={() => setShowForm(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>取消</button>
            <AsyncButton className="btn-primary" onClick={save} disabled={!canOperate(user,'memberManage')}>保存</AsyncButton>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">姓名 *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">电话</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">卡号</label>
            <input className="input" disabled={Boolean(form.id)&&!['owner','manager'].includes(user.role)} value={form.card_no} onChange={(e) => setForm({ ...form, card_no: e.target.value })} placeholder="留空自动生成" />
          </div>
          <div>
            <label className="label">卡类型</label>
            <select className="input" value={form.card_type} onChange={(e) => setForm({ ...form, card_type: e.target.value })}>
              <option value="storage">储值卡</option>
              <option value="times">次卡</option>
              <option value="discount">打折卡</option>
            </select>
          </div>
          {form.card_type === 'storage' && (
            <div>
              <label className="label">{form.id ? '余额（变更请使用充值/调整）' : '初始储值（元）'}</label>
              <input className="input" type="number" min="0" step="0.01" disabled={Boolean(form.id) || !can(user, 'adjust')} value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
            </div>
          )}
          {form.card_type === 'times' && (
            <div>
              <label className="label">次数</label>
              <input className="input" type="number" min="0" step="1" disabled={Boolean(form.id) || !can(user, 'adjust')} value={form.times_balance} onChange={(e) => setForm({ ...form, times_balance: e.target.value })} />
            </div>
          )}
          {form.card_type === 'discount' && (
            <div>
              <label className="label">折扣(0.88=8.8折)</label>
              <input className="input" type="number" step="0.01" disabled={!canChangeBenefits} value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />
            </div>
          )}
          <div>
            <label className="label">会员等级</label>
            <select className="input" disabled={!canChangeBenefits} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
              <option value="普通会员">普通会员</option>
              {levels.map((l) => <option key={l.id} value={l.name}>{l.name}（满{l.min_consume}自动升级）</option>)}
            </select>
          </div>
          <div>
            <label className="label">生日（用于生日双倍积分）</label>
            <input className="input" type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="member-expiry">会员有效期（留空为长期）</label><input id="member-expiry" className="input" type="date" value={form.expiry} onChange={e => setForm({ ...form, expiry: e.target.value })} /></div><div><label className="label">会员标签（逗号分隔）</label>
            <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="如：高消费,老客户" />
          </div>
          <div>
            <label className="label">推销员</label>
            <input className="input" value={form.salesman} onChange={(e) => setForm({ ...form, salesman: e.target.value })} />
          </div>
        </div>
      </Modal>

      {/* 充值 */}
      <Modal
        open={!!rechargeTarget}
        title={`会员充值：${rechargeTarget?.name || ''}`}
        onClose={() => { if (!rechargeBusy.current && !rechargeUnknown) setRechargeTarget(null) }}
        footer={
          <>
            <button className="btn-secondary" disabled={recharging || rechargeUnknown} onClick={() => setRechargeTarget(null)}>取消</button>
            <button className="btn-primary" disabled={recharging} onClick={doRecharge}>{recharging ? '提交中，请勿重复收款…' : rechargeUnknown ? '核对原充值结果' : '确认充值'}</button>
          </>
        }
      >
        {rechargeError && <p role="alert" className="p-3 mb-3 text-sm bg-red-50 text-red-700 rounded-lg">{rechargeError}</p>}
        {rechargeUnknown && <p className="p-3 mb-3 text-sm bg-amber-50 text-amber-800 rounded-lg">原充值结果尚未确认，已锁定表单。请核对原请求，勿再次收款或另开一笔充值。</p>}
        <fieldset disabled={recharging || rechargeUnknown} className="space-y-3">
          {plans.length > 0 && (
            <div>
              <label className="label">充值方案</label>
              <select className="input" value={recharge.plan_id || ''} onChange={(e) => onPickPlan(Number(e.target.value))}>
                <option value="">自定义充值</option>
                {plans.filter((p) => p.active).map((p) => (
                  <option key={p.id} value={p.id}>充{p.amount}送{p.gift_amount}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">{rechargeTarget?.card_type==='times'?'购次实收金额':'充值金额(本金)'}</label>
              <input aria-label="本次充值实收金额" className="input" type="number" value={recharge.amount} onChange={(e) => setRecharge({ ...recharge, amount: Number(e.target.value), plan_id: undefined })} />
            </div>
            <div>
              <label className="label">赠送金额</label>
              <input aria-label="本次充值赠送金额" className="input" type="number" value={recharge.bonus} onChange={(e) => setRecharge({ ...recharge, bonus: Number(e.target.value), plan_id: undefined })} />
            </div>
            <div>
              <label className="label">次卡次数</label>
              <input className="input" type="number" value={recharge.times} onChange={(e) => setRecharge({ ...recharge, times: Number(e.target.value) })} />
            </div>
          </div>
          <label className="block mt-3"><span className="label">收款方式</span><select className="input" value={rechargeMethod} onChange={e=>setRechargeMethod(e.target.value)}>{['现金','微信','支付宝','银行卡'].map(m=><option key={m}>{m}</option>)}</select></label>
          <div className="text-xs text-gray-400">次卡按购买次数增加权益，实际收款单独记录。</div>
        </fieldset>
      </Modal>

      {/* 详情 */}
      <Modal open={!!detail} title={`会员详情：${detail?.member?.name || ''}`} onClose={() => setDetail(null)} width="max-w-4xl">
        {detail && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge text={detail.member.level || '普通会员'} className="bg-amber-50 text-amber-600" />
                <span className="text-xs text-gray-400">生日：{detail.member.birthday || '未设置'}</span><span className="text-xs text-gray-400">有效期：{detail.member.expiry || '长期'}</span>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-3 mb-4 text-center">
              <div className="card p-3"><div className="text-xs text-gray-500">余额</div><div className="text-lg font-bold text-brand-600">{fmtMoney(detail.member.balance)}</div></div>
              <div className="card p-3"><div className="text-xs text-gray-500">赠金</div><div className="text-lg font-bold">{fmtMoney(detail.member.bonus_balance)}</div></div>
              <div className="card p-3"><div className="text-xs text-gray-500">次卡</div><div className="text-lg font-bold">{detail.member.times_balance}次</div></div>
              <div className="card p-3"><div className="text-xs text-gray-500">积分</div><div className="text-lg font-bold text-violet-600">{detail.member.points}</div></div>
              <div className="card p-3 flex flex-col justify-center">
                <div className="text-xs text-gray-500 mb-1">积分兑换</div>
                <div className="flex gap-1">
                  <input className="input !py-1 text-xs" type="number" min={0} value={exchangePts} onChange={(e) => setExchangePts(Number(e.target.value))} placeholder="数量" />
                  <AsyncButton className="btn-primary !py-1 text-xs whitespace-nowrap" disabled={!can(user,'recharge')} onClick={doExchangePoints}>兑换</AsyncButton>
                </div>
              </div>
            </div>

            {/* 消费画像 */}
            {detail.profile && (detail.profile.consume_count > 0 ? (
              <div className="grid grid-cols-4 gap-3 mb-4 text-center">
                <div className="card p-3"><div className="text-xs text-gray-500">累计消费</div><div className="text-lg font-bold text-amber-600">{fmtMoney(detail.profile.total_consume)}</div></div>
                <div className="card p-3"><div className="text-xs text-gray-500">消费次数</div><div className="text-lg font-bold">{detail.profile.consume_count} 次</div></div>
                <div className="card p-3"><div className="text-xs text-gray-500">客单价</div><div className="text-lg font-bold">{fmtMoney(detail.profile.avg_consume)}</div></div>
                <div className="card p-3"><div className="text-xs text-gray-500">最近消费</div><div className="text-sm font-bold pt-1">{fmtDateTime(detail.profile.last_consume_at)}</div></div>
              </div>
            ) : (
              <div className="mb-4 text-xs text-gray-400 text-center py-3 bg-gray-50 rounded-lg">暂无消费记录</div>
            ))}

            {detail.favoriteItems?.length > 0 && (
              <div className="mb-4">
                <div className="text-sm font-medium text-gray-600 mb-2">常消费项目</div>
                <div className="flex flex-wrap gap-2">
                  {detail.favoriteItems.map((f: any) => (
                    <span key={f.name} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 text-xs">
                      {f.name}
                      <span className="text-violet-400">×{f.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <MemberAssets key={detail.member.id} memberId={detail.member.id} initial={{member:detail.member,items:detail.transactions.slice(0,50),next_cursor:detail.transactions.length>50?detail.transactions[49].id:null}} onMember={member=>setDetail((previous:any)=>previous?.member?.id===member.id&&!(previous.member.asset_version>member.asset_version)?{...previous,member:{...previous.member,...member}}:previous)}/>

            <div className="flex items-center justify-between mt-4 mb-2">
              <div className="text-sm font-medium text-gray-600">优惠券</div>
              {can(user,'discount')&&<AsyncButton className="text-xs text-violet-600 hover:underline" onClick={async()=>{setCouponProfiles(await api.listCouponProfiles());setCouponProfileId(null);setShowIssueCoupon(true)}}>+ 发券</AsyncButton>}
            </div>
            <div className="max-h-40 overflow-y-auto">
              <table className="table w-full">
                <thead><tr><th>券名</th><th>类型</th><th>面值/折扣</th><th>状态</th></tr></thead>
                <tbody>
                  {memberCoupons.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.type === 'discount' ? '折扣券' : '代金券'}</td>
                      <td>{c.type === 'discount' ? `${Number((c.value * 10).toFixed(2))}折` : `¥${c.value}`}</td>
                      <td>
                        {c.status === 'unused' ? <Badge text="未使用" className="bg-emerald-50 text-emerald-600" /> : c.status === 'used' ? <Badge text="已使用" className="bg-gray-100 text-gray-500" /> : <Badge text="已过期" className="bg-red-50 text-red-500" />}
                      </td>
                    </tr>
                  ))}
                  {memberCoupons.length === 0 && (
                    <tr><td colSpan={4} className="text-gray-400 text-center py-3">暂无优惠券</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* 发券弹窗 */}
      <Modal
        open={showIssueCoupon}
        title={`发券给：${detail?.member?.name || ''}`}
        onClose={() => {if(!couponBusy.current)setShowIssueCoupon(false)}}
        width="max-w-sm"
        footer={
          <>
            <button className="btn-secondary" onClick={() => {if(!couponBusy.current)setShowIssueCoupon(false)}}>取消</button>
            <AsyncButton className="btn-primary" onClick={issueCoupon}>确认发券</AsyncButton>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block"><span className="label">连锁优惠券配置</span><select className="input" value={couponProfileId??''} onChange={e=>setCouponProfileId(e.target.value?Number(e.target.value):null)}><option value="">自定义本次发券</option>{couponProfiles.filter(p=>p.active===1).map(p=><option key={p.id} value={p.id}>{p.name} · {p.type==='discount'?`${p.value*10} 折`:`${p.value} 元`} · {p.valid_days} 天</option>)}</select></label>
          {couponProfileId&&<p className="text-xs text-gray-500">按门店当前配置发给本会员，有效期从实际发券时开始计算。</p>}
          <fieldset disabled={!!couponProfileId} className={couponProfileId?'hidden':'space-y-3'}>
          <div>
            <label className="label">券名 *</label>
            <input className="input" value={couponForm.name} onChange={(e) => setCouponForm({ ...couponForm, name: e.target.value })} placeholder="如：满100减20" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">类型</label>
              <select className="input" value={couponForm.type} onChange={(e) => setCouponForm({ ...couponForm, type: e.target.value })}>
                <option value="cash">代金券</option>
                <option value="discount">折扣券</option>
              </select>
            </div>
            <div>
              <label className="label">{couponForm.type === 'discount' ? '折扣率(0.88=8.8折)' : '面值(元)'}</label>
              <input className="input" type="number" step="0.01" min={0} value={couponForm.value} onChange={(e) => setCouponForm({ ...couponForm, value: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">满减门槛(元)</label>
              <input className="input" type="number" min={0} value={couponForm.min_amount} onChange={(e) => setCouponForm({ ...couponForm, min_amount: Number(e.target.value) })} />
            </div>
            <div>
              <label className="label">有效期至</label>
              <input className="input" type="date" value={couponForm.expire_at} onChange={(e) => setCouponForm({ ...couponForm, expire_at: e.target.value })} />
            </div>
          </div>
          </fieldset>
        </div>
      </Modal>

      <Confirm
        open={!!delTarget}
        title="删除会员"
        message={`确认删除会员「${delTarget?.name}」？`}
        onCancel={() => setDelTarget(null)}
        onConfirm={async () => {
          if (delTarget) {
            const res = await api.deleteMember(delTarget.id, user.id)
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
