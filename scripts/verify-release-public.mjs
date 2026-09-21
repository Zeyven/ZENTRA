import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='https://saas.zephael.cn';
const version=JSON.parse(await readFile('package.json','utf8')).version;
const hash=b=>createHash('sha256').update(b).digest('hex');
async function get(path){const r=await fetch(origin+path,{signal:AbortSignal.timeout(120000)});assert.equal(r.status,200,path);return Buffer.from(await r.arrayBuffer());}
const ready=JSON.parse((await get('/ready')).toString());assert.equal(ready.version,version);assert.equal(ready.ok,true);
const html=(await get('/')).toString();const local=await readFile('apps/client/out/web/index.html','utf8');
const script=local.match(/src="([^\"]+\.js)"/)[1];assert(html.includes(script));
assert.equal(hash(await get(script)),hash(await readFile('apps/client/out/web'+script)));
await get('/platform');
const name=`ZA-Thera-${version}-Windows-x64.exe`;
const binary=await readFile('apps/client/release/'+name);
for(const channel of ['stable','rc']){const feed=(await get('/updates/windows/'+channel+'/'+(channel==='stable'?'latest.yml':'rc.yml'))).toString();assert(feed.includes('version: '+version));assert(feed.includes(name));assert(feed.includes(createHash('sha512').update(binary).digest('base64')));}
const downloaded=await get('/updates/windows/stable/'+name);assert.equal(hash(downloaded),hash(binary));
const alias=await fetch(origin+'/updates/windows/stable/ZA-Thera-Setup.exe',{method:'HEAD'});assert.equal(alias.status,200);assert.equal(Number(alias.headers.get('content-length')),binary.length);
const result={version,ready,web_script:script,web_hash_verified:true,channels:['stable','rc'],public_installer_sha256:hash(downloaded),bytes:binary.length,download_alias_verified:true,checked_at:new Date().toISOString()};
await writeFile('.runtime/release-public-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
