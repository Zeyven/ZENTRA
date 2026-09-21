const MAX_BODY_BYTES=64*1024;
const MAX_ID_LENGTH=128;

function plainObject(value){
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
}
function exactKeys(value,keys){
 return plainObject(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}
function boundedString(value){return typeof value==='string'&&value.length>0&&value.length<=MAX_ID_LENGTH}
function operation(value,dataCheck){
 return exactKeys(value,['pgid','funid','data'])&&boundedString(value.pgid)&&boundedString(value.funid)&&dataCheck(value.data);
}
function reportClockData(value){
 if(!exactKeys(value,['array'])||!Array.isArray(value.array)||value.array.length<1||value.array.length>20)return false;
 return value.array.every(row=>{
  if(typeof row!=='string'||!row.length||row.length>MAX_BODY_BYTES)return false;
  try{const item=JSON.parse(row);return exactKeys(item,['bh','mc'])&&boundedString(item.bh)&&boundedString(item.mc)}catch{return false}
 });
}
function parseBody(body){
 if(!Buffer.isBuffer(body)||body.length>MAX_BODY_BYTES)throw Error('Invalid point-clock request body');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))}catch{throw Error('Invalid point-clock JSON')}
 return value;
}

// Shapes below are limited to fields observed in the supplied vendor logs. They
// validate input boundaries only; they do not claim that write semantics are known.
export function validateCurrentRequest(request){
 // The vendor log's base64 body "" decodes to zero bytes, not JSON "".
 // Heartbeats do not authenticate a device or invoke business operations.
 if(request.url==='HeadBeat'){
  if(!Buffer.isBuffer(request.body)||request.body.length!==0)throw Error('Invalid point-clock heartbeat');
  return null;
 }
 const value=parseBody(request.body);
 if(['SystemDeviceLogin','SystemClockInfo'].includes(request.url)){
  if(value!==null)throw Error('Invalid point-clock request shape');
  return value;
 }
 if(request.url==='SystemUserLogin'){
  if(!exactKeys(value,['id'])||!boundedString(value.id))throw Error('Invalid point-clock request shape');
  return value;
 }
 if(request.url==='CheckHandCode'){
  if(!Array.isArray(value)||value.length!==1||!operation(value[0],data=>exactKeys(data,['bh','id'])&&boundedString(data.bh)&&boundedString(data.id)))throw Error('Invalid point-clock request shape');
  return value;
 }
 if(request.url==='CheckJSCode'){
  if(!Array.isArray(value)||value.length!==1||!operation(value[0],data=>exactKeys(data,['bh'])&&boundedString(data.bh)))throw Error('Invalid point-clock request shape');
  return value;
 }
 if(request.url==='ReportClock'){
  if(!Array.isArray(value)||value.length!==1||!operation(value[0],reportClockData))throw Error('Invalid point-clock request shape');
  return value;
 }
 if(['CloseClock','GetItemInfo','GetRoomTec','GetWaitRoom','GetItemGradeInfo','GetCallServerInfo'].includes(request.url)){
  if(!Array.isArray(value)||value.length!==1||!operation(value[0],data=>data===null))throw Error('Invalid point-clock request shape');
  return value;
 }
 // AddClock/GetTecQueryList are known to contain two menu-selected records, but
 // current evidence does not establish enough field semantics for a strict contract.
 if(['AddClock','GetTecQueryList'].includes(request.url)){
  if(!Array.isArray(value)||value.length!==2||!value.every(row=>operation(row,()=>true)))throw Error('Invalid point-clock request shape');
  return value;
 }
 throw Error('Unsupported point-clock operation');
}

export {MAX_BODY_BYTES};
