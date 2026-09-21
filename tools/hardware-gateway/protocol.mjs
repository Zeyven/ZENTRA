// Limited, bounded Thrift binary codec for the observed vendor RPC envelope.
// Reference: https://github.com/apache/thrift/blob/master/doc/specs/thrift-binary-protocol.md
export class Incomplete extends Error {}
const MAX=256*1024;
const utf8=new TextDecoder('utf-8',{fatal:true});
function decodeText(bytes){try{return utf8.decode(bytes)}catch{throw Error('Invalid RPC text encoding')}}
class Reader {
 constructor(buffer){this.b=buffer;this.p=0;this.fields=0}
 take(n){if(n<0||n>MAX)throw Error('Invalid size');if(this.p+n>this.b.length)throw new Incomplete();const v=this.b.subarray(this.p,this.p+n);this.p+=n;return v}
 byte(){return this.take(1)[0]}
 short(){return this.take(2).readInt16BE()}
 int(){return this.take(4).readInt32BE()}
 bytes(){return this.take(this.int())}
 value(t,depth=0){
  if(depth>8)throw Error('Nesting limit');
  if(t===11)return this.bytes();
  if(t===8)return this.int();
  if(t===6)return this.short();
  if(t===2||t===3)return this.byte();
  if(t===4||t===10)return this.take(8);
  if(t===12){const out=new Map();for(;;){const type=this.byte();if(!type)return out;if(++this.fields>128)throw Error('Field limit');const id=this.short();if(out.has(id))throw Error('Duplicate field');out.set(id,{type,value:this.value(type,depth+1)})}}
  if(t===13){const kt=this.byte(),vt=this.byte(),n=this.int();if(n<0||n>64)throw Error('Map limit');const rows=[];for(let i=0;i<n;i++)rows.push([this.value(kt,depth+1),this.value(vt,depth+1)]);return {kt,vt,rows}}
  if(t===14||t===15){const type=this.byte(),n=this.int();if(n<0||n>64)throw Error('List limit');return Array.from({length:n},()=>this.value(type,depth+1))}
  throw Error('Unsupported field type');
 }
}
const int=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b};
const bytes=v=>{const b=Buffer.isBuffer(v)?v:Buffer.from(v);return Buffer.concat([int(b.length),b])};
const field=(type,id,value)=>{const h=Buffer.alloc(3);h[0]=type;h.writeInt16BE(id,1);return Buffer.concat([h,value])};
const stop=Buffer.from([0]);
function required(s,id,type){const f=s.get(id);if(!f||f.type!==type)throw Error('Invalid RPC field');return f.value}
export function decodeRequest(buffer){
 const r=new Reader(buffer);const marker=r.int();let method,type;
 if(marker<0){if((marker>>>8)!==0x800100)throw Error('Unsupported Thrift version');type=marker&255;method=decodeText(r.bytes())}
 else{method=decodeText(r.take(marker));type=r.byte()}
 // Both RPC methods in the reconstructed vendor service are declared oneway.
 // The supplied frame uses message type 4; accepting type 1 would allow an
 // unobserved request/reply contract while we always emit an OnAnsweCall event.
 if(method!=='OnAskCall'||type!==4)throw Error('Unsupported RPC method');
 const sequence=r.int(),args=r.value(12),askId=required(args,1,8),request=required(args,2,12);
 const url=decodeText(required(request,1,11)),map=required(request,2,13);
 if(map.kt!==11||map.vt!==11)throw Error('Invalid headers');
 const head=Object.create(null);for(const [k,v] of map.rows){const key=decodeText(k);if(Object.hasOwn(head,key))throw Error('Duplicate header');head[key]=decodeText(v)}
 const body=required(request,3,11);if(r.p>MAX)throw Error('Message limit');
 return {consumed:r.p,sequence,type,askId,url,head,body};
}
export function encodeAnswer(request,data){
 if(!data||![0,1].includes(data.code)||typeof data.msg!=='string')throw Error('Invalid business result');
 const failed=data.code===0;
 // The observed failure branch sets TRpcResponse.exstatus=1; its JSON has no code.
 // Do not send an outer success merely because the business error was serialized.
 const payload=failed?{msg:data.msg,data:''}:data;
 const headers=Object.entries(request.head);const map=Buffer.concat([Buffer.from([11,11]),int(headers.length),...headers.flatMap(([k,v])=>[bytes(k),bytes(v)])]);
 const response=Buffer.concat([field(8,1,int(failed?1:0)),field(11,2,bytes(failed?data.msg:'成功')),field(13,3,map),field(11,4,bytes(JSON.stringify(payload))),stop]);
 const answer=Buffer.concat([int(-2147418108),bytes('OnAnsweCall'),int(request.sequence),field(8,1,int(request.askId)),field(12,2,response),stop]);
 if(answer.length>MAX)throw Error('Message limit');
 return answer;
}
export const MAX_MESSAGE_BYTES=MAX;

// Virtual panel / offline diagnostics. This does not implement vendor login.
export function encodeRequest({url,head,body,sequence,askId}){
 if(typeof url!=='string'||!url||url.length>64||!Buffer.isBuffer(body))throw Error('Invalid request');
 const headers=Object.entries(head);
 if(headers.length>64||headers.some(([k,v])=>typeof v!=='string'||k.length>128||v.length>1024))throw Error('Invalid headers');
 const map=Buffer.concat([Buffer.from([11,11]),int(headers.length),...headers.flatMap(([k,v])=>[bytes(k),bytes(v)])]);
 const request=Buffer.concat([field(11,1,bytes(url)),field(13,2,map),field(11,3,bytes(body)),stop]);
 const packet=Buffer.concat([int(-2147418108),bytes('OnAskCall'),int(sequence),field(8,1,int(askId)),field(12,2,request),stop]);
 if(packet.length>MAX)throw Error('Message limit');return packet;
}
export function decodeAnswer(buffer){
 const r=new Reader(buffer);if(r.int()!==-2147418108||decodeText(r.bytes())!=='OnAnsweCall')throw Error('Invalid answer envelope');
 const sequence=r.int(),args=r.value(12),askId=required(args,1,8),response=required(args,2,12);
 const exstatus=required(response,1,8),exmsg=decodeText(required(response,2,11)),data=JSON.parse(decodeText(required(response,4,11)));
 if(r.p>MAX)throw Error('Message limit');return {consumed:r.p,sequence,askId,exstatus,exmsg,data};
}
