import {createHash} from 'node:crypto';

const DATE_TIME=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// The vendor binary signs the login challenge as MD5(registrationCode + datetime).
// The registration code must be provisioned by the vendor. This module never
// obtains, derives or persists that authorization value.
export function createLoginRegSn(registrationCode,datetime){
 if(typeof registrationCode!=='string'||registrationCode.length!==32||/[\x00-\x1f\x7f]/.test(registrationCode))throw Error('Invalid vendor registration code');
 if(typeof datetime!=='string'||!DATE_TIME.test(datetime))throw Error('Invalid vendor login datetime');
 return createHash('md5').update(registrationCode+datetime,'utf8').digest('hex');
}
