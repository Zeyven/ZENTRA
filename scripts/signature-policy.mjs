export function signatureDecision(signature,{allowUnsigned=false,publisher=''}={}){
 if(signature.Status==='NotSigned'&&!signature.Subject)return allowUnsigned?'unsigned-exception':'reject';
 if(signature.Status!=='Valid'||!signature.Subject)return 'reject';
 if(publisher&&!signature.Subject.includes(publisher))return 'reject';
 return 'valid';
}
