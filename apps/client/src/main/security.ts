import {isAbsolute,relative,resolve} from 'node:path';
import {BRAND_NAME} from '../shared/brand';
export const APP_ID='cn.zephael.zaspa.saas',APP_NAME=BRAND_NAME,APP_ORIGIN='zaspa-saas://app',API_ORIGIN='https://saas.zephael.cn';
// Storage and protocol identities remain stable when the visible brand changes.
export const APP_DATA_DIRECTORY='ZA-SPA SaaS';
export function assetPath(root:string,address:string){
 const url=new URL(address);if(url.protocol!=='zaspa-saas:'||url.hostname!=='app'||url.username||url.password)return null;
 let path:string;try{path=decodeURIComponent(url.pathname)}catch{return null}
 if(path.includes('\\')||path.includes('\0'))return null;
 if(path==='/'||path==='/index.html')return resolve(root,'index.html');
 if(!path.startsWith('/assets/'))return null;
 const target=resolve(root,'.'+path),inside=relative(root,target);return inside&&!inside.startsWith('..')&&!isAbsolute(inside)?target:null;
}
export function allowedNetwork(address:string,apiOrigin=API_ORIGIN,devOrigin?:string){
 try{const url=new URL(address);if(devOrigin&&url.origin===devOrigin)return !url.pathname.startsWith('/platform')&&!url.pathname.startsWith('/api/platform/');
 const expected=new URL(apiOrigin);const sameHost=url.host===expected.host&&(url.protocol===expected.protocol||url.protocol===(expected.protocol==='https:'?'wss:':'ws:'));
 return sameHost&&(/^\/api\/(merchant|public)\/v1(?:\/|$)/.test(url.pathname)||url.pathname.startsWith('/socket.io/'));
 }catch{return false}
}
