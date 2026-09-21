import {contextBridge,ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('saasDesktop',Object.freeze({
 gateway:(action:'state'|'start'|'stop'|'check',pairing:unknown)=>ipcRenderer.invoke('saas:gateway',action,pairing),
 detectHardware:()=>ipcRenderer.invoke('saas:hardware-detect'),
 info:()=>ipcRenderer.invoke('saas:info'),print:()=>ipcRenderer.invoke('saas:print'),
 update:(action:'state'|'check'|'download'|'install')=>ipcRenderer.invoke('saas:update',action)
}));
