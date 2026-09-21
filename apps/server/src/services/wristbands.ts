import {context,tenantQuery} from '../db/pools.js';
export async function lockBandConfiguration(){const c=context();await tenantQuery("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[c.merchantId+':'+c.storeId+':wristband-config'])}
