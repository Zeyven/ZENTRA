import {tenantQuery} from '../db/pools.js';
import {audit,event} from '../access.js';
import {Decimal} from 'decimal.js';

// The caller holds the member row lock. Shared members retain their issuing
// store's level policy; spending at another store cannot replace that policy.
export async function updateMemberLevel(memberId:number){
 const member=(await tenantQuery('SELECT * FROM members WHERE id=$1 FOR UPDATE',[memberId])).rows[0];
 if(!member)return;
 const levels=(await tenantQuery('SELECT * FROM member_levels WHERE store_id=$1 ORDER BY min_consume DESC,sort_order DESC,id DESC',[member.store_id])).rows;
 const total=(await tenantQuery("SELECT coalesce(sum(payable),0) total FROM orders WHERE member_id=$1 AND status='closed'",[memberId])).rows[0].total;
 const base=levels.find(l=>l.name===member.base_level),qualified=levels.find(l=>new Decimal(l.min_consume).lte(total));
 // A custom manually assigned level with no configured threshold stays intact.
 const next=(!base&&member.base_level!=='普通会员')?member.base_level:qualified&&new Decimal(qualified.min_consume).gte(base?.min_consume??0)?qualified.name:member.base_level;
 if(next===member.level)return member;
 const updated=(await tenantQuery('UPDATE members SET level=$1 WHERE id=$2 RETURNING *',[next,memberId])).rows[0];
 await audit('member.level.changed',{before:member.level,after:next,base:member.base_level,net_consumption:total,policy_store_id:member.store_id},'member',memberId);
 await event('member.changed',memberId,member.scope_store_id??null);return updated;
}
