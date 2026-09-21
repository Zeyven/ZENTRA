import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {ensure,HttpError} from './errors.js';
const secrets={merchant:process.env.MERCHANT_JWT_SECRET,platform:process.env.PLATFORM_JWT_SECRET};
for(const [realm,secret] of Object.entries(secrets))if(!secret||secret.length<64)throw Error(`${realm} JWT secret must have at least 64 characters`);
ensure(secrets.merchant!==secrets.platform,500,'CONFIGURATION','JWT realms must use independent keys');
export const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export const randomToken=()=>randomBytes(32).toString('base64url');
const derive=(password:string,salt:Buffer)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
export async function hashPassword(password:string){const salt=randomBytes(16);return `scrypt-v1$${salt.toString('hex')}$${(await derive(password,salt)).toString('hex')}`}
export async function verifyPassword(password:string,encoded:string){
 const [version,salt,key]=encoded.split('$');if(version!=='scrypt-v1'||!salt||salt.length!==32||!key||key.length!==128)return false;
 return timingSafeEqual(await derive(password,Buffer.from(salt,'hex')),Buffer.from(key,'hex'));
}
export interface Claims {realm:'merchant'|'platform'|'support';sid:string;uid:number;mid?:string;version:number;grant?:string;platform_admin?:true}
export function signToken(claims:Claims){const audience=claims.realm==='platform'?'platform':'merchant';return jwt.sign(claims,secrets[audience]!,{algorithm:'HS256',issuer:'za-spa-saas',audience,expiresIn:'8h'})}
export function readToken(token:string,realm:'merchant'|'platform'):Claims{
 try{
  const claims=jwt.verify(token,secrets[realm]!,{algorithms:['HS256'],issuer:'za-spa-saas',audience:realm}) as Claims;
  ensure(claims&&Number.isSafeInteger(claims.uid)&&typeof claims.sid==='string'&&(realm==='platform'?claims.realm==='platform':['merchant','support'].includes(claims.realm)),401,'INVALID_SESSION','登录已失效');
  return claims;
 }catch{throw new HttpError(401,'INVALID_SESSION','登录已失效，请重新登录')}
}
