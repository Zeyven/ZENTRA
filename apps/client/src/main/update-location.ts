import {dirname} from 'node:path';
import {NsisUpdater,type AppUpdater} from 'electron-updater';

export function preserveUpdateLocation(updater:AppUpdater,exePath:string,isPackaged:boolean){
  // The running executable is authoritative; registry paths may be stale.
  if(isPackaged&&updater instanceof NsisUpdater)updater.installDirectory=dirname(exePath);
}
