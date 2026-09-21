import {canOperate} from '../utils/permissions'
import { useCallback, useState } from 'react'
import { api } from '../api'
import type { Technician } from '../types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'
import { TECH_STATUS, TECH_LEVELS, fmtNum, today, sortTechnicians, parseMoneyInput } from '../utils/format'
import { AsyncButton, Modal, Confirm, Badge, EmptyState } from '../components/ui'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import ClockTerminal from './ClockTerminal'

const emptyForm = {
  id: undefined as number | undefined,
  name: '',
  code: '',
  phone: '',
  level: '普通',
  base_salary: '4500',
  commission_rate: '30',
  wheel_rate: '0',
  dianzhong_rate: '0',
  half_rate: '0',
  dianzhong_bonus: 0,
  add_time_rate: '0'
}

export default function Technicians(): JSX.Element {
  const user = useAuth((s) => s.user)!
  const supportScope=useAuth(s=>s.support?.scope)
  const canManage=canOperate(user,'technicianManage')&&(['owner','manager'].includes(user.role)||user.role==='support'&&supportScope==='configuration')
  const [list, setList] = useState<Technician[]>([])
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [delTarget, setDelTarget] = useState<Technician | null>(null)
  const [attendance, setAttendance] = useState<any[]>([])
  const [showAttendance, setShowAttendance] = useState(false)
  const [monthly, setMonthly] = useState<any[]>([])
  const [showMonthly, setShowMonthly] = useState(false)
  // 技能配置
  const [skillTech, setSkillTech] = useState<Technician | null>(null)
  const [skillItems, setSkillItems] = useState<any[]>([])
  const [skillChecked, setSkillChecked] = useState<Record<number, boolean>>({})

  const load = useCallback(async () => {
    setList(sortTechnicians(await api.listTechnicians()))
  }, [])


  useAutoRefresh(load)

  const openSkills = async (t: Technician): Promise<void> => {
    const [items, skillMap] = await Promise.all([api.listItems(), api.listTechSkills()])
    const serviceItems = items.filter((i) => i.type === 'service' && !i.sold_out)
    const checked: Record<number, boolean> = {}
    for (const sid of skillMap[t.id] || []) checked[sid] = true
    setSkillTech(t)
    setSkillItems(serviceItems)
    setSkillChecked(checked)
  }

  const saveSkills = async (): Promise<void> => {
    if (!skillTech) return
    const ids = Object.keys(skillChecked).filter((k) => skillChecked[Number(k)]).map(Number)
    const res = await api.setTechSkills(skillTech.id, ids)
    if (res.ok) {
      toast(`已保存 ${skillTech.name} 的技能（${ids.length} 项${ids.length === 0 ? '，即不限项目' : ''}）`)
      setSkillTech(null)
    } else {
      toast(res.msg || '保存失败', 'error')
    }
  }

  const save = async (): Promise<void> => {
    if (!form.name || !form.code) {
      toast('请填写姓名和工号', 'error')
      return
    }
    const commissionRate = parseMoneyInput(form.commission_rate)
    if (!Number.isFinite(commissionRate) || commissionRate <= 0) {
      toast('请填写技师基础提成比例（必须大于 0）', 'error')
      return
    }
    const baseSalary = parseMoneyInput(form.base_salary)
    if (!Number.isFinite(baseSalary) || baseSalary < 0) {
      toast('请填写有效的底薪（不能为负数）', 'error')
      return
    }
    const wheelRate = parseMoneyInput(form.wheel_rate)
    if (!Number.isFinite(wheelRate) || wheelRate < 0 || wheelRate > 100) {
      toast('请填写有效的轮钟提成比例（0-100）', 'error')
      return
    }
    const dianzhongRate = parseMoneyInput(form.dianzhong_rate)
    if (!Number.isFinite(dianzhongRate) || dianzhongRate < 0 || dianzhongRate > 100) {
      toast('请填写有效的点钟提成比例（0-100）', 'error')
      return
    }
    const halfRate = parseMoneyInput(form.half_rate)
    if (!Number.isFinite(halfRate) || halfRate < 0 || halfRate > 100) {
      toast('请填写有效的半钟提成比例（0-100）', 'error')
      return
    }
    const addTimeRate = parseMoneyInput(form.add_time_rate)
    if (!Number.isFinite(addTimeRate) || addTimeRate < 0 || addTimeRate > 100) {
      toast('请填写有效的加钟提成比例（0-100）', 'error')
      return
    }
    const res = await api.saveTechnician({
      ...form,
      base_salary: baseSalary,
      commission_rate: commissionRate,
      wheel_rate: wheelRate,
      dianzhong_rate: dianzhongRate,
      half_rate: halfRate,
      add_time_rate: addTimeRate
    }, user.id)
    if (res.ok) {
      toast('已保存')
      setShowForm(false)
      await load()
    } else {
      toast(res.msg || '保存失败', 'error')
    }
  }

  const clock = async (t: Technician): Promise<void> => {
    const res = await api.clockTechnician(t.id, user.id)
    if (res.ok) toast(res.status === 'on' ? `${t.name} 已打卡上班` : `${t.name} 已打卡下班`)
    await load()
  }

  const openAttendance = async (): Promise<void> => {
    setAttendance(await api.listAttendance(today()))
    setShowAttendance(true)
  }

  const openMonthly = async (): Promise<void> => {
    setMonthly(await api.listMonthlyAttendance())
    setShowMonthly(true)
  }

  return (
    <div className="h-full flex flex-col">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <h2 className="text-lg font-bold text-gray-800">技师钟房</h2>
        <div className="flex gap-2">
          <AsyncButton className="btn-secondary" onClick={openAttendance}>
            📋 考勤记录
          </AsyncButton>
          <AsyncButton className="btn-secondary" onClick={openMonthly}>
            📊 月度考勤
          </AsyncButton>
          {canManage&&<button className="btn-primary" onClick={() => { setForm(emptyForm); setShowForm(true) }} disabled={!canOperate(user,'technicianManage')}>
            + 新增技师
          </button>}
        </div>
      </header>

      <div className="flex-1 overflow-auto px-5 py-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {list.map((t) => {
            const st = TECH_STATUS[t.status] || TECH_STATUS.off
            return (
              <div key={t.id} className="card p-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center font-bold">
                      {t.code}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-800">{t.name}</div>
                      <div className="text-xs text-gray-400">{t.level}</div>
                    </div>
                  </div>
                  <span className={`flex items-center gap-1 text-xs ${st.color}`}>
                    <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                    {st.label}
                  </span>
                </div>
                {t.serving_item && <div className="text-xs text-gray-500 mb-2">⏱ {t.serving_item}</div>}
                {user.role!=='technician'&&<div className="text-xs text-gray-400 mb-3">
                  底薪 ¥{fmtNum(t.base_salary)} · 基础 {t.commission_rate}%
                  {((t as any).wheel_rate || 0) > 0 && <span className="text-emerald-600 ml-1">· 轮 {(t as any).wheel_rate}%</span>}
                  {((t as any).dianzhong_rate || 0) > 0 && <span className="text-sky-600 ml-1">· 点 {(t as any).dianzhong_rate}%</span>}
                  {((t as any).half_rate || 0) > 0 && <span className="text-amber-600 ml-1">· 半 {(t as any).half_rate}%</span>}
                  {((t as any).dianzhong_bonus || 0) > 0 && <span className="text-sky-600 ml-1">· 点钟奖 ¥{(t as any).dianzhong_bonus}</span>}
                  {(t.reserved_today || 0) > 0 && <span className="text-violet-500 ml-1">📅 今日预约 {t.reserved_today} 场</span>}
                </div>}
                <div className="flex gap-1.5">
                  {user.role!=='support'&&<AsyncButton className="btn-secondary flex-1 text-xs py-1.5" disabled={!canOperate(user,'clockOperate')} onClick={() => clock(t)}>
                    {t.status === 'off' ? '上班打卡' : '下班打卡'}
                  </AsyncButton>}
                  {canManage&&<><AsyncButton className="btn-secondary flex-1 text-xs py-1.5" onClick={() => openSkills(t)} disabled={!canOperate(user,'technicianManage')}>
                    技能
                  </AsyncButton>
                  <button className="btn-secondary flex-1 text-xs py-1.5" onClick={() => { setForm({ id: t.id, name: t.name, code: t.code, phone: t.phone ?? '', level: t.level, base_salary: String(t.base_salary ?? 0), commission_rate: String(t.commission_rate ?? ''), wheel_rate: String((t as any).wheel_rate ?? 0), dianzhong_rate: String((t as any).dianzhong_rate ?? 0), half_rate: String((t as any).half_rate ?? 0), dianzhong_bonus: (t as any).dianzhong_bonus ?? 0, add_time_rate: String((t as any).add_time_rate ?? 0) }); setShowForm(true) }} disabled={!canOperate(user,'technicianManage')}>
                    编辑
                  </button>
                  <button className="btn-ghost text-xs px-2 text-red-500" onClick={() => setDelTarget(t)} disabled={!canOperate(user,'technicianManage')}>
                    删除
                  </button></>}
                </div>
              </div>
            )
          })}
        </div>
        {list.length === 0 && <EmptyState text="暂无技师" />}
        {user.role==='technician'&&<ClockTerminal/>}
      </div>

      {/* 表单 */}
      <Modal
        open={showForm}
        title={form.id ? '编辑技师' : '新增技师'}
        onClose={() => setShowForm(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>取消</button>
            <AsyncButton className="btn-primary" onClick={save} disabled={!canOperate(user,'technicianManage')}>保存</AsyncButton>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">姓名 *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">工号/牌号 *</label>
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <label className="label">电话</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">等级</label>
            <select className="input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
              {TECH_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">底薪</label>
            <input className="input" type="number" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} />
          </div>
          <div><label className="label">基础提成(%)</label><input className="input" type="number" value={form.commission_rate} onChange={(e) => setForm({ ...form, commission_rate: e.target.value })} /><div className="text-xs text-gray-400 mt-1">未单独配置时的回退比例</div></div>
          <div><label className="label">轮钟提成(%)</label><input className="input" type="number" min={0} value={form.wheel_rate} onChange={(e) => setForm({ ...form, wheel_rate: e.target.value })} placeholder="0=按基础提成" /></div>
          <div><label className="label">点钟提成(%)</label><input className="input" type="number" min={0} value={form.dianzhong_rate} onChange={(e) => setForm({ ...form, dianzhong_rate: e.target.value })} placeholder="0=按基础提成" /></div>
          <div><label className="label">加钟提成(%)</label><input className="input" type="number" min={0} value={form.add_time_rate} onChange={(e) => setForm({ ...form, add_time_rate: e.target.value })} placeholder="0=按基础提成" /></div>
          <div><label className="label">半钟提成(%)</label><input className="input" type="number" min={0} value={form.half_rate} onChange={(e) => setForm({ ...form, half_rate: e.target.value })} placeholder="0=按基础提成" /></div>
          <div>
            <label className="label">点钟奖励(元/钟)</label>
            <input className="input" type="number" min={0} step={0.5} value={form.dianzhong_bonus} onChange={(e) => setForm({ ...form, dianzhong_bonus: Number(e.target.value) })} placeholder="顾客指定技师的额外奖励" />
          </div>
        </div>
      </Modal>

      {/* 考勤 */}
      <Modal open={showAttendance} title={`考勤记录（${today()}）`} onClose={() => setShowAttendance(false)} width="max-w-2xl">
        <table className="table w-full">
          <thead>
            <tr><th>技师</th><th>上班</th><th>下班</th></tr>
          </thead>
          <tbody>
            {attendance.map((a) => (
              <tr key={a.id}>
                <td>{a.code}号 {a.name}</td>
                <td>{a.clock_in_at?.slice(11, 16) || '-'}</td>
                <td>{a.clock_out_at?.slice(11, 16) || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {attendance.length === 0 && <EmptyState text="今日暂无考勤" />}
      </Modal>

      {/* 月度考勤统计 */}
      <Modal open={showMonthly} title="月度考勤统计" onClose={() => setShowMonthly(false)} width="max-w-2xl">
        <table className="table w-full">
          <thead>
            <tr><th>技师</th><th>等级</th><th>出勤天数</th><th>累计工时</th></tr>
          </thead>
          <tbody>
            {monthly.map((m) => {
              const hours = Math.floor((m.total_minutes || 0) / 60)
              const mins = (m.total_minutes || 0) % 60
              return (
                <tr key={m.id}>
                  <td className="font-medium">{m.code}号 {m.name}</td>
                  <td>{m.level}</td>
                  <td className="font-semibold text-emerald-600">{m.work_days} 天</td>
                  <td>{hours > 0 ? `${hours}小时${mins}分` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {monthly.length === 0 && <EmptyState text="本月暂无考勤数据" />}
      </Modal>

      {/* 技师技能配置 */}
      <Modal
        open={!!skillTech}
        title={`技师技能：${skillTech?.name || ''}`}
        onClose={() => setSkillTech(null)}
        width="max-w-lg"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setSkillTech(null)}>取消</button>
            <AsyncButton className="btn-primary" onClick={saveSkills}>保存技能</AsyncButton>
          </>
        }
      >
        <div className="text-xs text-gray-400 mb-3">勾选该技师可做的服务项目；不勾选任何项目 = 不限技能（可做所有项目）。点单时按此校验调派。</div>
        <div className="max-h-72 overflow-y-auto grid grid-cols-2 gap-1.5">
          {skillItems.map((it) => (
            <label key={it.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 text-sm">
              <input type="checkbox" className="accent-brand-500" checked={!!skillChecked[it.id]} onChange={(e) => setSkillChecked({ ...skillChecked, [it.id]: e.target.checked })} />
              <span className="flex-1">{it.name}</span>
              <span className="text-xs text-gray-400">{it.is_primary ? '主项' : '附项'}</span>
            </label>
          ))}
        </div>
        {skillItems.length === 0 && <EmptyState text="暂无服务项目" />}
      </Modal>

      <Confirm
        open={!!delTarget}
        title="删除技师"
        message={`确认删除技师「${delTarget?.name}」？`}
        onCancel={() => setDelTarget(null)}
        onConfirm={async () => {
          if (delTarget) {
            await api.deleteTechnician(delTarget.id, user.id)
            toast('已删除')
          }
          setDelTarget(null)
          await load()
        }}
      />
    </div>
  )
}
