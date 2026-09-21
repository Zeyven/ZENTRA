import {inTenant,platformPool,tenantQuery,closePools} from '../apps/server/src/db/pools.js';
const merchant=(await platformPool.query('SELECT id FROM merchants ORDER BY created_at DESC LIMIT 3')).rows;
try{for(const m of merchant)await inTenant(m.id,async()=>{
 console.log('asset_operations UPDATE granted:',(await tenantQuery("SELECT has_table_privilege(current_user,'asset_operations','UPDATE') AS allowed")).rows[0].allowed);
 await tenantQuery('SELECT * FROM asset_operations LIMIT 1 FOR UPDATE');
})}catch(e:any){console.log('Exact PostgreSQL failure:',e.code,e.message)}finally{await closePools()}
