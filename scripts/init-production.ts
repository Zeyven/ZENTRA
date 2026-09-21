import {randomBytes} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {platformPool,closePools} from '../apps/server/src/db/pools.js';
import {hashPassword,verifyPassword} from '../apps/server/src/security.js';
assert.equal(process.env.NODE_ENV,'production');assert.equal(new URL(process.env.PLATFORM_DATABASE_URL!).pathname,'/za_spa_saas');
const file='.runtime/production-platform-account.json';
try{
 let account:{username:string;password:string};
 try{account=JSON.parse(await readFile(file,'utf8'))}catch(error:any){if(error.code!=='ENOENT')throw error;account={username:'platform-admin',password:randomBytes(24).toString('base64url')};await writeFile(file,JSON.stringify(account,null,2),{flag:'wx',mode:0o600})}
 const existing=(await platformPool.query('SELECT username,password FROM platform_users')).rows;
 if(existing.length){assert.equal(existing.length,1);assert.equal(existing[0].username,account.username);assert(await verifyPassword(account.password,existing[0].password));console.log('Existing independent platform administrator verified; no password changed.')}
 else{await platformPool.query('INSERT INTO platform_users(username,password,name) VALUES($1,$2,$3)',[account.username,await hashPassword(account.password),'澜序平台管理员']);console.log('Independent production platform administrator initialized. No merchant or business data created.')}
}finally{await closePools()}
