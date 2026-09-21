import {hashPassword} from '../apps/server/src/security.js';
import {platformPool,closePools} from '../apps/server/src/db/pools.js';
import {AccountName,Password} from '@za-spa/contracts';
const username=AccountName.parse(process.env.INIT_ADMIN_USERNAME),password=Password.parse(process.env.INIT_ADMIN_PASSWORD);
try{
 const row=await platformPool.query(`INSERT INTO platform_users(username,password,name) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM platform_users) RETURNING id`,[username,await hashPassword(password),process.env.INIT_ADMIN_NAME||'平台管理员']);
 if(!row.rowCount)throw Error('Platform already initialized; no existing account was changed');
 console.log('Platform administrator initialized. No merchants or business records created.');
}finally{await closePools()}
