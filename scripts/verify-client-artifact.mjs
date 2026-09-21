import {extractFile,listPackage} from '@electron/asar';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {join,relative} from 'node:path';
const client='apps/client',archive=client+'/release/win-unpacked/resources/app.asar';
const packageInfo=JSON.parse(extractFile(archive,'package.json').toString());
const sourceVersion=JSON.parse(await readFile(client+'/package.json','utf8')).version;
assert.equal(packageInfo.description,'ZA Thera｜澜序 - 洗浴娱乐行业智慧运营系统');
assert.equal(packageInfo.version,sourceVersion);
const files=listPackage(archive,{isPack:false});
assert.equal(files.some(p=>/(^|[\\/])(?:\.env(?:\.|$)|\.runtime|test\.env|database-credentials\.json|za-logo\.png)/.test(p)),false);
let verified=0;
for(const surface of ['main','preload','renderer']) {
 const root=client+'/out/'+surface;
 for(const entry of await readdir(root,{withFileTypes:true,recursive:true})) {
  if(!entry.isFile())continue;
  const path=join(entry.parentPath,entry.name),name=join('out',surface,relative(root,path));
  assert.deepEqual(extractFile(archive,name),await readFile(path),'Packaged bytes differ: '+name);verified++;
 }
}
const icon=await readFile(client+'/release/win-unpacked/resources/icon.png');
assert.deepEqual(icon,await readFile(client+'/build/icon.png'));
const artifact=`ZA-Thera-${sourceVersion}-Windows-x64.exe`;
const installer=await readFile(client+'/release/'+artifact);
const feed=await readFile(client+'/release/latest.yml','utf8');
assert(feed.includes(createHash('sha512').update(installer).digest('base64')));
assert(feed.includes(artifact));
const result={name:'ZA Thera｜澜序',version:packageInfo.version,verified_bundled_files:verified,bytes:installer.length,sha256:createHash('sha256').update(installer).digest('hex'),source_icon_matches:true,update_metadata_matches:true};
await writeFile('.runtime/brand-artifact-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));


