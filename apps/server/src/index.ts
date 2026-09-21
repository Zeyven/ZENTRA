import {createServer} from 'node:http';
import {createApp} from './app.js';
import {closePools} from './db/pools.js';
import {attachRealtime} from './realtime.js';
import {startClockJobs} from './jobs.js';
import {flushDiagnostics,startMaintenanceCleanup} from './services/maintenance.js';
const port=Number(process.env.PORT||8791);
const jobs=process.env.NODE_ENV==='test'&&process.env.SAAS_TEST_JOBS!=='1'?null:startClockJobs();
const diagnosticsCleanup=process.env.NODE_ENV==='test'&&process.env.SAAS_TEST_JOBS!=='1'?null:startMaintenanceCleanup();
const server=createServer(createApp(()=>({healthy:jobs?.healthy()??true,jobs:jobs?.status()})));
let stopping=false;
const realtime=await attachRealtime(server,()=>{void shutdown(1)});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({event:'server.started',port:(server.address() as {port:number}).port,version:'1.0.22'})));
async function shutdown(code:number){if(stopping)return;stopping=true;const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();try{await Promise.all([jobs?.close(),diagnosticsCleanup?.close()]);await realtime.close();await flushDiagnostics();await closePools();process.exit(code)}catch{process.exit(1)}}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void shutdown(0)});
process.on('uncaughtException',(error)=>console.error(JSON.stringify({event:'process.uncaught_exception',message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined})));
process.on('unhandledRejection',(reason)=>console.error(JSON.stringify({event:'process.unhandled_rejection',message:reason instanceof Error?reason.message:String(reason),stack:reason instanceof Error?reason.stack:undefined})));


