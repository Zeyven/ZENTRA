import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const {createUpdateController,scheduleUpdateChecks}=createRequire(import.meta.url)('../apps/client/src/main/updates.ts');
test('automatic checks share in-flight work, preserve downloaded update, and require explicit installation',async()=>{
 const updater=new EventEmitter() as any;let checks=0,downloads=0,installs=0,complete!:()=>void;
 updater.checkForUpdates=()=>{checks++;return new Promise<void>(resolve=>{complete=()=>{updater.emit('update-available',{version:'1.0.1'});resolve()}})};
 updater.downloadUpdate=async()=>{downloads++;updater.emit('download-progress',{percent:42});updater.emit('update-downloaded')};updater.quitAndInstall=()=>{installs++};
 const c=createUpdateController(updater);const one=c.check(),two=c.check();assert.equal(checks,1);complete();await Promise.all([one,two]);assert.equal(c.state().status,'available');assert.equal(downloads,0);assert.equal(installs,0);
 await c.download();assert.equal(c.state().status,'downloaded');await c.check();assert.equal(checks,1);assert.equal(installs,0);c.install();assert.equal(installs,1);assert.throws(()=>c.install());
});
test('offline checks can recover and scheduled checks stop on cleanup',async()=>{
 const updater=new EventEmitter() as any;let count=0;updater.checkForUpdates=async()=>{count++;if(count===1)throw Error('offline');updater.emit('update-not-available')};const c=createUpdateController(updater);
 await assert.rejects(c.check(),/offline/);assert.equal(c.state().status,'error');await c.check();assert.equal(c.state().status,'current');
 let calls=0;const stop=scheduleUpdateChecks(async()=>{calls++},5,10);await new Promise(r=>setTimeout(r,40));stop();const end=calls;assert(end>=2);await new Promise(r=>setTimeout(r,25));assert.equal(calls,end);
});



