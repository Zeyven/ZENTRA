import {Router} from 'express';
import {z} from 'zod';
import {defaultActions,defaultPages,sensitiveActions,actionCeilings as roleActionCeilings,defaultOperations} from '@za-spa/contracts';
import {audit,event,merchantRoute} from '../access.js';
import {tenantQuery} from '../db/pools.js';
import {ensure} from '../errors.js';
export const permissionsRouter=Router();
async function configuration(storeId?:number){
 const pages=structuredClone(defaultPages),actions=structuredClone(defaultActions),actionCeilings=structuredClone(roleActionCeilings);
 if(storeId)for(const row of (await tenantQuery('SELECT * FROM role_permissions WHERE store_id=$1',[storeId])).rows){
  if(row.kind==='action'&&row.enabled===0)actionCeilings[row.role]=actionCeilings[row.role]?.filter(a=>a!==row.perm_key)??[];
  const target=row.kind==='page'?pages:actions,list=target[row.role]??[];
  target[row.role]=row.enabled===1?[...new Set([...list,row.perm_key])]:list.filter(key=>key!==row.perm_key);
 }
 for(const role of Object.keys(actions))actions[role]=actions[role].filter(a=>roleActionCeilings[role]?.includes(a));
 return {pages,actions,actionCeilings,operations:defaultOperations};
}
permissionsRouter.get('/permissions/self',merchantRoute({support:'read'},async(_req,actor)=>{
 return {pages:{[actor.role]:actor.pages},actions:{[actor.role]:actor.actions},operations:{[actor.role]:actor.operations}};
}));
permissionsRouter.get('/permissions',merchantRoute({owner:true,store:true},async(_req,actor)=>configuration(actor.storeId)));
permissionsRouter.put('/permissions',merchantRoute({owner:true,store:true,write:true},async(req,actor)=>{
 const roles=['manager','floor','technician'] as const;
 const matrix=z.record(z.string(),z.array(z.string()).max(50));
 const body=z.object({pages:matrix,actions:matrix}).strict().parse(req.body);
 for(const role of [...Object.keys(body.pages),...Object.keys(body.actions)])ensure(roles.includes(role as any),400,'INVALID_ROLE','只能配置门店员工角色');
 for(const role of roles){
  const pages=body.pages[role]??defaultPages[role],actions=body.actions[role]??defaultActions[role];
  ensure(pages.every(p=>defaultPages[role].includes(p)),400,'PERMISSION_CEILING','页面授权超出该角色的范围');
  ensure(actions.every(a=>roleActionCeilings[role].includes(a)),400,'PERMISSION_CEILING','操作授权超出该角色的范围');
  await tenantQuery('DELETE FROM role_permissions WHERE store_id=$1 AND role=$2',[actor.storeId,role]);
  for(const [kind,available,enabled] of [['page',defaultPages[role],pages],['action',sensitiveActions,actions]] as const)
   for(const key of available)await tenantQuery('INSERT INTO role_permissions(store_id,role,kind,perm_key,enabled) VALUES($1,$2,$3,$4,$5)',[actor.storeId,role,kind,key,enabled.includes(key)?1:0]);
 }
 await audit('permissions.updated',body);await event('access.changed');return configuration(actor.storeId);
}));
