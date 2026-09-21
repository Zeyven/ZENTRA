from pathlib import Path
p=Path('apps/client/src/renderer/src/pages/Settings.tsx')
s=p.read_text(encoding='utf-8')
start=s.index('    setRooms(await api.listRooms())')
end=s.index('  }, [])',start)+len('  }, [])')
s=s[:start]+'''    const tasks: Array<Promise<unknown>>=[]
    if(tab==='rooms'||tab==='wristbands')tasks.push(api.listRooms().then(setRooms))
    if(tab==='logs')tasks.push(api.listLogs(200).then(setLogs))
    if(tab==='wristbands')tasks.push(api.listWristbands().then(setWristbandsList))
    if(tab==='levels')tasks.push(api.listMemberLevels().then(setLevels))
    if(tab==='plans')tasks.push(api.listRechargePlans().then(setPlans))
    if(tab==='announcements')tasks.push(api.listAnnouncements().then(setAnnouncements))
    if(tab==='marketing')tasks.push(Promise.all([api.listMarketingWorkflows(),api.listMarketingOutbox()]).then(([w,o])=>{setMarketingWorkflows(w);setMarketingOutbox(o)}))
    if(tab==='channels')tasks.push(Promise.all([api.listChannelConnections(),api.listChannelOrders()]).then(([c,o])=>{setChannelConnections(c);setChannelOrders(o)}))
    if(tab==='booking_payment')tasks.push(Promise.all([api.listBookingPaymentProviders(),api.listBookingPayments(),api.listBookingRefunds(),api.bookingReconciliation()]).then(([p,b,r,c])=>{setBookingProviders(p);setBookingPayments(b);setBookingRefunds(r);setBookingReconciliation(c)}))
    if(tab==='pricing')tasks.push(Promise.all([api.listPricingRules(),api.getSnapshot()]).then(([r,s])=>{setPricingRules(r);setPricingItems([...(s.services||[]),...(s.products||[])])}))
    if(tab==='approvals')tasks.push(Promise.all([api.listApprovals('pending'),api.alerts()]).then(([a,b])=>{setApprovals(a);setAlerts(b)}))
    await Promise.all(tasks)
    setLoadError('')
    } catch(error) { setLoadError(error instanceof Error?error.message:'读取设置失败') }
  }, [tab])'''+s[end:]
s=s.replace("  const [tab, setTab] = useState<Tab>('store')","  const [tab, setTab] = useState<Tab>('store')\n  const [loadError,setLoadError]=useState('')")
s=s.replace('  const load = useCallback(async () => {\n    const s', '  const load = useCallback(async () => {\n    try {\n    const s')
s=s.replace('    try { setSchemes(JSON.parse(s.discount_schemes', "    try { setClaimCoupons(JSON.parse(s.claim_coupons||'[]')) } catch { setClaimCoupons([]) }\n    try { setSchemes(JSON.parse(s.discount_schemes")
s=s.replace('        <div className="flex-1 overflow-auto p-5">','        <div className="flex-1 overflow-auto p-5">\n          {loadError&&<div role="alert" className="p-3 mb-4 bg-red-50 text-red-700">{loadError}<button className="btn-secondary ml-3" onClick={load}>重试</button></div>}')
s=s.replace("import { useAutoRefresh } from '../hooks/useAutoRefresh'","import { useAutoRefresh } from '../hooks/useAutoRefresh'\nimport OwnerConsole from './OwnerConsole'")
s=s.replace('<UserSettings users={users} onReload={load} />','<OwnerConsole/>')
# Account provisioning is now merchant-scoped in OwnerConsole.
a=s.index('function UserSettings(');b=s.index('function DiscountSettings(',a)
s=s[:a]+s[b:]
s=s.replace("    ...(user.role === 'tech' ? [{ k: 'stores' as Tab, label: '门店管理' }] : []),",'')
p.write_text(s,encoding='utf-8')
