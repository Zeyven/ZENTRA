import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Modal,Confirm,DialogLayer} from '../../apps/client/src/renderer/src/components/ui';
import ReasonDialog,{askReason} from '../../apps/client/src/renderer/src/components/ReasonDialog';
import '../../apps/client/src/renderer/src/index.css';
function Fixture(){
 const [confirm,setConfirm]=useState(false),[parent,setParent]=useState(false),[child,setChild]=useState(false),[result,setResult]=useState(''),[custom,setCustom]=useState(false);
 return <><ReasonDialog/><button onClick={()=>setConfirm(true)}>落钟</button><button onClick={()=>setParent(true)}>打开会员</button><output>{result}</output>
 <Modal open={child} title="编辑会员" onClose={()=>setChild(false)}><input aria-label="会员姓名"/><button onClick={()=>setChild(false)}>保存会员</button></Modal>
 <Modal open={parent} title="会员详情" onClose={()=>setParent(false)}><button onClick={()=>setChild(true)}>编辑</button></Modal>
 <button onClick={()=>setCustom(true)}>打开巡房</button>{custom&&<DialogLayer title="巡房" onClose={()=>setCustom(false)}><div className="bg-white p-8"><button onClick={()=>setChild(true)}>登记异常</button></div></DialogLayer>}
 <Confirm open={confirm} title="落钟" message="确认落钟？" onCancel={()=>setConfirm(false)} onConfirm={async()=>{const value=await askReason('结束服务原因');setResult(value);setConfirm(false)}}/>
 </>
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
