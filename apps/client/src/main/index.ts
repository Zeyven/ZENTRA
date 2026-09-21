import {createGatewayController} from '../../../../tools/hardware-gateway/controller.mjs';
import {detectHardware} from './hardware';
import {app,BrowserWindow,ipcMain,Menu,net,protocol,session,type IpcMainInvokeEvent} from 'electron';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {autoUpdater} from 'electron-updater';
import {preserveUpdateLocation} from './update-location';
import {createUpdateController,scheduleUpdateChecks} from './updates';
import {APP_ID,APP_NAME,APP_DATA_DIRECTORY,APP_ORIGIN,API_ORIGIN,assetPath,allowedNetwork} from './security';
app.setName(APP_NAME);app.setAppUserModelId(APP_ID);app.setPath('userData',resolve(app.getPath('appData'),APP_DATA_DIRECTORY));
process.on('uncaughtException',(error)=>console.error(JSON.stringify({event:'main.uncaught_exception',message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined})));
process.on('unhandledRejection',(reason)=>console.error(JSON.stringify({event:'main.unhandled_rejection',message:reason instanceof Error?reason.message:String(reason),stack:reason instanceof Error?reason.stack:undefined})));
const testing=!app.isPackaged&&process.env.NODE_ENV==='test';
if(testing&&process.env.SAAS_TEST_USER_DATA)app.setPath('userData',resolve(process.env.SAAS_TEST_USER_DATA));
const devOrigin=!app.isPackaged&&process.env.ELECTRON_RENDERER_URL?new URL(process.env.ELECTRON_RENDERER_URL).origin:undefined;
if(devOrigin&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(devOrigin))throw Error('Development renderer must use loopback');
let apiOrigin=devOrigin??API_ORIGIN;
if(testing&&process.env.SAAS_TEST_API_ORIGIN){const url=new URL(process.env.SAAS_TEST_API_ORIGIN);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Test API must use loopback');apiOrigin=url.origin}
protocol.registerSchemesAsPrivileged([{scheme:'zaspa-saas',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.enableSandbox();let window:BrowserWindow|null=null;
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{window?.restore();window?.focus()});
 void app.whenReady().then(async()=>{
  const rendererRoot=resolve(__dirname,'../renderer'),clientSession=session.fromPartition('persist:za-spa-saas');
  clientSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));clientSession.setPermissionCheckHandler(()=>false);
  clientSession.protocol.handle('zaspa-saas',request=>{const file=assetPath(rendererRoot,request.url);return file?net.fetch(pathToFileURL(file).href):new Response('Not found',{status:404})});
  clientSession.webRequest.onBeforeRequest((details,callback)=>{
   const scheme=new URL(details.url).protocol;
   const allowed=scheme==='zaspa-saas:'?!!assetPath(rendererRoot,details.url):['data:','blob:'].includes(scheme)||allowedNetwork(details.url,apiOrigin,devOrigin);
   callback({cancel:!allowed});
  });
  // A header policy supplements the shared renderer policy with a fixed desktop API destination.
  clientSession.webRequest.onHeadersReceived((details,callback)=>{
   const connections=[APP_ORIGIN,apiOrigin,apiOrigin.replace(/^http/,'ws'),...(devOrigin?[devOrigin,devOrigin.replace(/^http/,'ws')]:[])].join(' ');
   const policy=`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ${connections}; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`;
   callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[policy]}});
  });
  Menu.setApplicationMenu(null);
  window=new BrowserWindow({width:1440,height:940,minWidth:1050,minHeight:700,title:APP_NAME,icon:resolve(app.isPackaged?process.resourcesPath:resolve(app.getAppPath(),'build'),'icon.png'),show:!testing,backgroundColor:'#f5f7f9',webPreferences:{preload:resolve(__dirname,'../preload/index.js'),session:clientSession,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,webviewTag:false,allowRunningInsecureContent:false,devTools:!app.isPackaged}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.webContents.on('will-navigate',event=>{const url=new URL(event.url);if(!(devOrigin?url.origin===devOrigin:event.url.startsWith(APP_ORIGIN+'/'))||!['/','/index.html'].includes(url.pathname))event.preventDefault()});
  window.on('closed',()=>{window=null});
  const trusted=(event:IpcMainInvokeEvent)=>{const frame=event.senderFrame;if(!frame||event.sender!==window?.webContents||frame!==window.webContents.mainFrame||!(devOrigin?frame.url.startsWith(devOrigin+'/'):frame.url.startsWith(APP_ORIGIN+'/')))throw Error('Untrusted IPC sender')};
  const gateway=createGatewayController(apiOrigin,{allowTestLoopback:testing||!!devOrigin});
  ipcMain.handle('saas:gateway',async(event,action:unknown,pairing:any)=>{trusted(event);if(action==='state')return gateway.state();if(action==='stop')return gateway.stop();if(action==='start')return gateway.start(pairing);if(action==='check')return gateway.check();throw Error('无效网关操作')});
  window.webContents.on('render-process-gone',()=>void gateway.stop('界面进程已退出，网关停止'));
  window.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame&&!_inPlace)void gateway.stop('界面重新载入，网关停止')});
  app.once('before-quit',()=>void gateway.stop());
  ipcMain.handle('saas:hardware-detect',event=>{trusted(event);return detectHardware()});
  ipcMain.handle('saas:info',event=>{trusted(event);return {name:APP_NAME,version:app.getVersion(),appId:APP_ID,apiOrigin,channel:'stable'}});
  ipcMain.handle('saas:print',event=>{trusted(event);return new Promise((resolve,reject)=>event.sender.print({silent:false,printBackground:true},(success,reason)=>success?resolve({printed:true}):reject(Error(reason||'打印未完成'))))});
  autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=false;autoUpdater.channel='latest';autoUpdater.allowPrerelease=false;autoUpdater.allowDowngrade=false;autoUpdater.setFeedURL({provider:'generic',url:API_ORIGIN+'/updates/windows/stable'});
  preserveUpdateLocation(autoUpdater,app.getPath('exe'),app.isPackaged);
  const updates=createUpdateController(autoUpdater);
  const stopUpdates=app.isPackaged?scheduleUpdateChecks(updates.check):()=>{};
  app.once('before-quit',stopUpdates);
  ipcMain.handle('saas:update',async(event,action:unknown)=>{trusted(event);if(action==='state')return updates.state();if(!app.isPackaged)throw Error('开发版本不使用安装包更新通道');if(action==='check')return updates.check();if(action==='download')return updates.download();if(action==='install')return updates.install();throw Error('更新操作无效')});
  await window.loadURL(devOrigin?process.env.ELECTRON_RENDERER_URL!:APP_ORIGIN+'/');
 }).catch(error=>{console.error('Desktop startup failed:',error.message);app.exit(1)});
 app.on('window-all-closed',()=>app.quit());
}

