// Summarize response JSON shapes from the user-supplied Hardware ZIP.
// It emits no device, tenant, technician, customer, or response values.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
const exec=promisify(execFile);
const archive=process.argv[2];
if(!archive)throw Error('Usage: node inspect_vendor_answers.mjs <Hardware.zip>');
const selected=process.argv[3];
const known=new Set(['SystemDeviceLogin','SystemClockInfo','SystemUserLogin','CheckHandCode','CheckJSCode','CloseClock','GetTecQueryList','ReportClock','GetItemInfo','GetRoomTec','AddClock','GetWaitRoom','GetItemGradeInfo','GetCallServerInfo']);
const safe=new Set(['msg','data','code','status','clock','t1','t2','t3','t4','t5','array','id','bh','mc','pgid','funid','name','type','title','url','company','roomname','telephone','menu','token','result','success']);
function shape(value,depth=0){
 if(depth>8)return 'depth-limit';
 if(Array.isArray(value))return {array:[...new Set(value.map(item=>JSON.stringify(shape(item,depth+1)))).values()].sort()};
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[safe.has(key)?key:'<other-field>',shape(item,depth+1)]));
 return value===null?'null':typeof value;
}
function firstJson(text){
 let depth=0,inString=false,escaped=false;
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(inString){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')inString=false;continue}
  if(char==='"'){inString=true;continue}
  if(char==='{')depth++;
  if(char==='}'&&--depth===0)return JSON.parse(text.slice(0,index+1));
 }
 throw Error('Incomplete JSON');
}
const {stdout:list}=await exec('tar',['-tf',archive],{maxBuffer:8*1024*1024});
const entries=list.split(/\r?\n/).filter(name=>/\/Commlog\.\d{4}-\d\d-\d\d\.txt$/.test(name)&&(selected===undefined||name===selected));
if(selected!==undefined&&!entries.length)throw Error('Requested log entry was not found');
const found=new Map(),counts=new Map();
for(const entry of entries){
 const child=spawn('tar',['-xOf',archive,entry],{stdio:['ignore','pipe','ignore']});
 const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
 for await(const line of lines){
  const match=/Interface:\s*([A-Za-z][A-Za-z0-9]+)\s+(\{.*)$/.exec(line);
  if(!match||!known.has(match[1]))continue;
  let body;try{body=firstJson(match[2])}catch{continue}
  const op=match[1],encoded=JSON.stringify(shape(body));
  counts.set(op,(counts.get(op)??0)+1);
  if(!found.has(op))found.set(op,new Set());found.get(op).add(encoded);
 }
 const exit=await new Promise(resolve=>child.once('close',resolve));
 if(exit!==0)throw Error(`Could not read ${entry}`);
}
const answers=Object.fromEntries([...found].sort(([a],[b])=>a.localeCompare(b)).map(([operation,shapes])=>[operation,{records:counts.get(operation),shapes:[...shapes].sort().map(JSON.parse)}]));
console.log(JSON.stringify({answers},null,2));
