import {useCallback,useEffect,useRef,useState} from 'react'
import {PurchaseCreate,PurchaseReceipt,PurchaseCancel,TransferCreate,type PurchaseOrder,type InventoryTransfer} from '@za-spa/contracts'
import {supplyApi,type StockProduct,type Supplier,type PurchaseSummary,type TransferSummary} from '../api/inventory'
import {useAuth,canWriteBusiness} from '../store/auth'
import {useAutoRefresh} from '../hooks/useAutoRefresh'
import {can} from '../utils/permissions'
import {AsyncButton,Badge,EmptyState,Modal} from '../components/ui'
import {fmtMoney} from '../utils/format'
import {toast} from '../store/toast'
import './inventory-orders.css'

const labels:Record<string,string>={draft:'待处理',partial:'部分收货',received:'已收货',dispatched:'在途',cancelled:'已取消'}
const Status=({value}:{value:string})=><Badge text={labels[value]??value} className={value==='received'?'bg-emerald-50 text-emerald-700':value==='cancelled'?'bg-gray-100 text-gray-500':'bg-amber-50 text-amber-700'}/>
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'读取失败，请重试'
type DraftLine={item_id:number;target_item_id:number;qty:number;cost:number}
const blankLine=():DraftLine=>({item_id:0,target_item_id:0,qty:1,cost:0})
type Pending={path:string;body:unknown;key:string;apply:(result:any)=>void}

export default function InventoryOrders({kind}:{kind:'purchase'|'transfer'}){
 const {user,merchant,realm,currentStoreId,stores}=useAuth()
 const writable=canWriteBusiness(true)
 const adjustable=writable&&can(user,'adjust')
 const [rows,setRows]=useState<Array<PurchaseSummary|TransferSummary>>([]),[before,setBefore]=useState<number>(),[next,setNext]=useState<number|null>(null),[history,setHistory]=useState<Array<number|undefined>>([])
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[detail,setDetail]=useState<PurchaseOrder|InventoryTransfer|null>(null),[detailLoading,setDetailLoading]=useState(false)
 const [create,setCreate]=useState(false),[products,setProducts]=useState<StockProduct[]>([]),[suppliers,setSuppliers]=useState<Supplier[]>([]),[destinations,setDestinations]=useState<Array<{id:number;name:string}>>([]),[targets,setTargets]=useState<StockProduct[]>([]),[targetLoading,setTargetLoading]=useState(false)
 const [supplierId,setSupplierId]=useState(0),[targetStore,setTargetStore]=useState(0),[remark,setRemark]=useState(''),[lines,setLines]=useState<DraftLine[]>([blankLine()])
 const [supplierForm,setSupplierForm]=useState(false),[supplierName,setSupplierName]=useState(''),[contact,setContact]=useState(''),[phone,setPhone]=useState('')
 const [mode,setMode]=useState<'receive'|'return'>('receive'),[quantities,setQuantities]=useState<Record<number,number>>({}),[reason,setReason]=useState('')
 const [busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false),[formError,setFormError]=useState('')
 const pending=useRef<Pending|null>(null),running=useRef(false),mounted=useRef(true),listSequence=useRef(0),detailSequence=useRef(0)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;listSequence.current++;detailSequence.current++}},[])
 const load=useCallback(async()=>{
  const sequence=++listSequence.current
  try{const result=await(kind==='purchase'?supplyApi.purchases(before):supplyApi.transfers(before));if(!mounted.current||sequence!==listSequence.current)return;setRows(result.items);setNext(result.next_cursor);setError('')}
  catch(e){if(mounted.current&&sequence===listSequence.current)setError(errorMessage(e))}
  finally{if(mounted.current&&sequence===listSequence.current)setLoading(false)}
 },[kind,before])
 useAutoRefresh(load)
 async function openDetail(id:number){
  if(running.current||unknown)return
  const sequence=++detailSequence.current;setDetailLoading(true);setFormError('')
  try{const result=await(kind==='purchase'?supplyApi.purchase(id):supplyApi.transfer(id));if(!mounted.current||sequence!==detailSequence.current)return;setDetail(result);setQuantities({});setReason('');setMode('receive')}
  catch(e){if(mounted.current)setError(errorMessage(e))}finally{if(mounted.current)setDetailLoading(false)}
 }
 async function execute(operation:Pending){
  if(running.current)return;running.current=true;setBusy(true);setFormError('');pending.current=operation
  try{const result=await supplyApi.mutate(operation.path,operation.body,operation.key);if(!mounted.current)return;pending.current=null;setUnknown(false);operation.apply(result);toast('操作已保存')}
  catch(e){if(!mounted.current)return;const uncertain=(e as {code?:string})?.code==='RESULT_UNKNOWN';setUnknown(uncertain);if(!uncertain)pending.current=null;setFormError(errorMessage(e))}
  finally{running.current=false;if(mounted.current)setBusy(false)}
 }
 function submit(path:string,body:unknown,apply:Pending['apply']){if(unknown||running.current)return;return execute({path,body,key:crypto.randomUUID(),apply})}
 function validate<T>(schema:{safeParse:(data:unknown)=>any},body:T):T|null{const result=schema.safeParse(body);if(!result.success){setFormError(result.error.issues[0]?.message??'请核对表单');return null}return result.data}
 async function openCreate(){
  setFormError('');setError('');setDetailLoading(true)
  try{const [items,others]=await Promise.all([supplyApi.products(),kind==='purchase'?supplyApi.suppliers():supplyApi.destinations()]);if(!mounted.current)return;setProducts(items);if(kind==='purchase')setSuppliers(others as Supplier[]);else setDestinations(others);setLines([blankLine()]);setRemark('');setSupplierId(0);setTargetStore(0);setTargets([]);setCreate(true)}
  catch(e){if(mounted.current)setError(errorMessage(e))}finally{if(mounted.current)setDetailLoading(false)}
 }
 useEffect(()=>{
  if(!targetStore){setTargets([]);return}
  let active=true;setTargetLoading(true);setTargets([])
  supplyApi.targetProducts(targetStore).then(items=>{if(active)setTargets(items)}).catch(e=>{if(active)setFormError(errorMessage(e))}).finally(()=>{if(active)setTargetLoading(false)})
  return()=>{active=false}
 },[targetStore])
 function saveDraft(){
  if(kind==='purchase'){
   const body=validate(PurchaseCreate,{...(supplierId?{supplier_id:supplierId}:{}),remark,items:lines.map(i=>({item_id:i.item_id,ordered_qty:i.qty,unit_cost:i.cost}))});if(!body)return
   return submit('/purchase-orders',body,result=>{setCreate(false);setDetail(result);setQuantities({});setReason('');setMode('receive')})
  }
  const body=validate(TransferCreate,{from_store_id:currentStoreId,to_store_id:targetStore,remark,items:lines.map(i=>({item_id:i.item_id,target_item_id:i.target_item_id,qty:i.qty}))});if(!body)return
  return submit('/inventory-transfers',body,result=>{setCreate(false);setDetail(result)})
 }
 function receivePurchase(){
  if(!detail||!('order_no' in detail))return
  if(Object.values(quantities).some(q=>!Number.isFinite(q)||q<0)){setFormError('处理数量必须是有效的非负数');return}
  if(!Object.values(quantities).some(q=>q>0)){setFormError('请填写至少一项处理数量');return}
  const body=validate(PurchaseReceipt,{version:detail.version,mode,reason,items:detail.items.filter(i=>(quantities[i.id]??0)>0).map(i=>({id:i.id,qty:quantities[i.id]}))});if(!body)return
  return submit('/purchase-orders/'+detail.id+'/receive',body,result=>{setDetail(result);setQuantities({});setReason('')})
 }
 function cancelPurchase(){if(!detail||!('order_no' in detail))return;const body=validate(PurchaseCancel,{version:detail.version,reason});if(body)return submit('/purchase-orders/'+detail.id+'/cancel',body,result=>{setDetail(result);setReason('')})}
 function transferAction(action:'dispatch'|'receive'|'cancel'){if(detail)return submit('/inventory-transfers/'+detail.id+'/'+action,{},setDetail)}
 const close=()=>{if(busy||unknown)return;setCreate(false);setDetail(null);setSupplierForm(false);setFormError('');detailSequence.current++}
 const patchLine=(index:number,patch:Partial<DraftLine>)=>setLines(rows=>rows.map((line,i)=>i===index?{...line,...patch}:line))
 const notice=<>{formError&&<p role="alert" className="supply-error">{formError}</p>}{unknown&&<div className="supply-error"><p>结果尚未确认，表单已保留。重试会沿用原请求编号。</p><AsyncButton className="btn-secondary mt-2" disabled={busy} onClick={()=>pending.current&&execute(pending.current)}>核对原请求结果</AsyncButton></div>}</>
 return (<section className="supply-workspace">
  <div className="supply-heading"><div><p className="supply-eyebrow">{kind==='purchase'?'PURCHASING':'STORE TRANSFER'}</p><h3>{kind==='purchase'?'采购与收货':'门店间的有序流转'}</h3><p>{kind==='purchase'?'分批验收、按单退货，每次库存变化都有据可查。':'调出店确认发货，调入店验收收货，分别记录库存。'}</p></div>
   <div className="flex gap-2"><AsyncButton className="btn-secondary" disabled={busy||unknown} onClick={load}>刷新列表</AsyncButton>{(kind==='purchase'?writable:adjustable)&&<AsyncButton className="btn-primary" disabled={detailLoading||busy||unknown} onClick={openCreate}>{kind==='purchase'?'新建采购单':'新建调拨单'}</AsyncButton>}</div>
  </div>
  {error&&<p role="alert" className="supply-error">{error}</p>}
  {detailLoading&&<p role="status" className="text-sm text-gray-500">正在读取单据资料…</p>}
  <div className="card overflow-auto"><table className="table w-full"><thead><tr><th>单据编号</th><th>{kind==='purchase'?'供应商':'调拨门店'}</th><th>状态</th><th>备注</th><th>操作</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} data-testid={'supply-'+row.id}><td className="font-medium">{'order_no' in row?row.order_no:row.transfer_no}</td><td>{'order_no' in row?row.supplier_name??'未指定供应商':`${row.from_store_name} → ${row.to_store_name}`}</td><td><Status value={row.status}/></td><td>{row.remark||'—'}</td><td><AsyncButton className="text-brand-600 text-sm" disabled={detailLoading||busy||unknown} onClick={()=>openDetail(row.id)}>查看明细</AsyncButton></td></tr>)}</tbody></table>
   {!rows.length&&<EmptyState text={loading?'正在读取单据…':error?'单据读取失败':'暂无单据，创建后将在这里保留流转记录'}/>}</div>
  <div className="flex justify-end gap-2"><button className="btn-secondary" disabled={!history.length||busy||unknown} onClick={()=>{setBefore(history.at(-1));setHistory(history.slice(0,-1));setLoading(true)}}>上一页</button><button className="btn-secondary" disabled={!next||busy||unknown} onClick={()=>{setHistory([...history,before]);setBefore(next!);setLoading(true)}}>下一页</button></div>

  <Modal open={create} title={kind==='purchase'?'新建采购单':'新建调拨单'} width="max-w-4xl" onClose={close} footer={<><button className="btn-secondary" disabled={busy||unknown} onClick={close}>取消</button><AsyncButton className="btn-primary" disabled={busy||unknown||targetLoading} onClick={saveDraft}>保存单据</AsyncButton></>}>
   {notice}<fieldset disabled={busy||unknown} className="space-y-4">
    {kind==='purchase'?<div className="flex items-end gap-2"><label className="flex-1"><span className="label">供应商</span><select aria-label="供应商" className="input" value={supplierId} onChange={e=>setSupplierId(Number(e.target.value))}><option value={0}>未指定供应商</option>{suppliers.filter(s=>s.active===1).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="btn-secondary" onClick={()=>{setSupplierName('');setContact('');setPhone('');setSupplierForm(true)}}>新增供应商</button></div>:<label className="block"><span className="label">调入门店</span><select aria-label="调入门店" className="input" value={targetStore} onChange={e=>{setTargetStore(Number(e.target.value));setLines(lines.map(l=>({...l,target_item_id:0})))}}><option value={0}>请选择已授权的门店</option>{destinations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>{!destinations.length&&<p className="text-sm text-amber-700 mt-2">暂无同时具备库存调整权限的其他门店。</p>}</label>}
    {!products.length&&<p className="text-sm text-amber-700">请先新增启用库存管理的商品。</p>}
    <div className="space-y-3">{lines.map((line,index)=><div className="supply-draft-line" key={index}>
     <label><span className="label">{kind==='purchase'?'采购商品':'调出商品'}</span><select aria-label={'商品 '+(index+1)} className="input" value={line.item_id} onChange={e=>{const id=Number(e.target.value);patchLine(index,{item_id:id,cost:products.find(p=>p.id===id)?.cost??0})}}><option value={0}>选择商品</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.stock} {p.unit}</option>)}</select></label>
     {kind==='transfer'?<label><span className="label">对应调入商品</span><select aria-label={'调入商品 '+(index+1)} className="input" value={line.target_item_id} disabled={targetLoading||!targetStore} onChange={e=>patchLine(index,{target_item_id:Number(e.target.value)})}><option value={0}>{targetLoading?'正在读取…':'选择对应商品'}</option>{targets.map(p=><option key={p.id} value={p.id}>{p.name} · {p.unit}</option>)}</select></label>:<label><span className="label">采购单价（元）</span><input aria-label={'单价 '+(index+1)} className="input" type="number" min={0} step="0.01" value={line.cost} onChange={e=>patchLine(index,{cost:e.target.valueAsNumber})}/></label>}
     <label><span className="label">数量</span><input aria-label={'数量 '+(index+1)} className="input" type="number" min="0.001" step="0.001" value={line.qty} onChange={e=>patchLine(index,{qty:e.target.valueAsNumber})}/></label><button className="btn-ghost" aria-label={'移除明细 '+(index+1)} disabled={lines.length===1} onClick={()=>setLines(lines.filter((_,i)=>i!==index))}>移除</button>
    </div>)}</div>
    <button className="btn-secondary" disabled={lines.length>=(kind==='purchase'?500:200)} onClick={()=>setLines([...lines,blankLine()])}>添加商品明细</button>
    <label className="block"><span className="label">{kind==='purchase'?'采购备注':'调拨原因（必填）'}</span><textarea aria-label="单据备注" className="input" maxLength={500} value={remark} onChange={e=>setRemark(e.target.value)}/></label>
   </fieldset>
  </Modal>
  <Modal open={supplierForm} title="新增供应商" onClose={()=>{if(!busy&&!unknown)setSupplierForm(false)}} footer={<AsyncButton className="btn-primary" disabled={busy||unknown} onClick={()=>{if(!supplierName.trim()){setFormError('请填写供应商名称');return}return submit('/suppliers',{name:supplierName.trim(),contact_name:contact.trim(),phone:phone.trim()},result=>{setSuppliers([...suppliers,result]);setSupplierId(result.id);setSupplierForm(false)})}}>保存供应商</AsyncButton>}>
   {notice}<fieldset disabled={busy||unknown} className="space-y-3">{[['供应商名称',supplierName,setSupplierName],['联系人',contact,setContact],['联系电话',phone,setPhone]].map(([label,value,setter])=><label className="block" key={String(label)}><span className="label">{String(label)}</span><input aria-label={String(label)} className="input" maxLength={label==='供应商名称'?100:200} value={String(value)} onChange={e=>(setter as (v:string)=>void)(e.target.value)}/></label>)}</fieldset>
  </Modal>
  <Modal open={!!detail} title={detail&&'order_no' in detail?'采购单明细':'调拨单明细'} width="max-w-4xl" onClose={close} footer={<button className="btn-secondary" disabled={busy||unknown} onClick={close}>关闭</button>}>
   {detail&&<><div className="flex justify-between gap-3 mb-4"><div><b>{'order_no' in detail?detail.order_no:detail.transfer_no}</b><p className="text-sm text-gray-500 mt-1">{'order_no' in detail?detail.supplier_name??'未指定供应商':`${detail.from_store_name} → ${detail.to_store_name}`}</p></div><div className="flex items-center gap-2"><Status value={detail.status}/><AsyncButton className="btn-secondary" disabled={busy||unknown||detailLoading} onClick={()=>openDetail(detail.id)}>刷新明细</AsyncButton></div></div>{notice}
    <p className="text-sm text-gray-500 mb-3">{detail.remark||'无备注'}</p>
    {'order_no' in detail?<>
     <div className="overflow-auto"><table className="table w-full"><thead><tr><th>商品</th><th>采购数量</th><th>单价</th><th>累计收货</th><th>累计退货</th>{adjustable&&detail.status!=='cancelled'&&<th>本次{mode==='receive'?'收货':'退货'}</th>}</tr></thead><tbody>{detail.items.map(line=><tr key={line.id}><td>{line.item_name} / {line.unit}</td><td>{line.ordered_qty}</td><td>{fmtMoney(line.unit_cost)}</td><td>{line.received_qty}</td><td>{line.returned_qty}</td>{adjustable&&detail.status!=='cancelled'&&<td><input aria-label={'处理数量 '+line.item_name} className="input supply-qty" type="number" min={0} step="0.001" max={mode==='receive'?line.ordered_qty-line.received_qty:line.received_qty-line.returned_qty} disabled={busy||unknown} value={quantities[line.id]??0} onChange={e=>setQuantities({...quantities,[line.id]:e.target.valueAsNumber})}/></td>}</tr>)}</tbody></table></div>
     <p className="text-xs text-gray-500 mt-3">退货按累计收货扣减；如需补货，请新建采购单。采购单价保留在单据中，库存成本报表按商品配置成本记录。</p>
     {adjustable&&detail.status!=='cancelled'&&<fieldset disabled={busy||unknown} className="supply-actions"><label><span className="label">处理方式</span><select aria-label="处理方式" className="input" value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setQuantities({})}}><option value="receive">收货入库</option><option value="return">采购退货</option></select></label><label className="flex-1"><span className="label">操作原因（必填）</span><input aria-label="单据操作原因" className="input" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label><AsyncButton className="btn-primary" disabled={busy||unknown} onClick={receivePurchase}>确认{mode==='receive'?'收货':'退货'}</AsyncButton>{detail.status==='draft'&&<AsyncButton className="btn-secondary" disabled={busy||unknown} onClick={cancelPurchase}>取消采购单</AsyncButton>}</fieldset>}
    </>:<>
     <div className="overflow-auto"><table className="table w-full"><thead><tr><th>调出商品</th><th>调入商品</th><th>数量</th></tr></thead><tbody>{detail.items.map(line=><tr key={line.id}><td>{line.item_name}</td><td>{line.target_item_name}</td><td>{line.qty} {line.unit}</td></tr>)}</tbody></table></div>
     {adjustable&&<div className="supply-actions">{detail.status==='draft'&&currentStoreId===detail.from_store_id&&<><AsyncButton className="btn-primary" disabled={busy||unknown} onClick={()=>transferAction('dispatch')}>确认发货</AsyncButton><AsyncButton className="btn-secondary" disabled={busy||unknown} onClick={()=>transferAction('cancel')}>取消调拨单</AsyncButton></>}{detail.status==='dispatched'&&(currentStoreId===detail.to_store_id?<AsyncButton className="btn-primary" disabled={busy||unknown} onClick={()=>transferAction('receive')}>确认收货</AsyncButton>:<p className="text-sm text-gray-500">货品在途，等待调入门店验收。</p>)}</div>}
    </>}
   </>}
  </Modal>
 </section>
 )
}
