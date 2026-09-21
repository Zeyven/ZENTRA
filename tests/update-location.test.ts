import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {NsisUpdater}=require('electron-updater');
const {preserveUpdateLocation}=require('../apps/client/src/main/update-location.ts');

test('real NSIS updater passes running custom directory to installer even when registry default differs',()=>{
  const updater=new NsisUpdater(null,{version:'1.0.21',isPackaged:true});
  const target=join('D:/','门店 软件','ZA-Thera');
  preserveUpdateLocation(updater,join(target,'ZA-Thera.exe'),true);
  Object.defineProperty(updater,'installerPath',{value:'C:/cache/update.exe'});
  let spawned:any;
  updater.spawnLog=async(file:string,args:string[])=>{spawned={file,args}};
  assert.equal(updater.doInstall({isSilent:false,isForceRunAfter:true,isAdminRightsRequired:false}),true);
  assert.deepEqual(spawned,{file:'C:/cache/update.exe',args:['--updated','--force-run',`/D=${target}`]});
});

test('development launches never override an installation path',()=>{
  const updater=new NsisUpdater(null,{version:'1.0.21',isPackaged:false});
  preserveUpdateLocation(updater,'C:/development/electron.exe',false);
  assert.equal(updater.installDirectory,undefined);
});
