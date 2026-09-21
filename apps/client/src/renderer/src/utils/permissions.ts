import {defaultPages,defaultActions,type Operation} from '@za-spa/contracts'
export type PageKey='board'|'orders'|'technicians'|'clockroom'|'items'|'members'|'reservations'|'queue'|'reports'|'shift'|'settings'|'headquarters'|'organization'|'approvals'
export const ROLE_PAGES=defaultPages,ROLE_ACTIONS=defaultActions
let config:{pages:Record<string,string[]>;actions:Record<string,string[]>;operations?:Record<string,string[]>}|null=null
export function setPermConfig(value:typeof config){config=value}
export function can(user:{role:string}|null|undefined,action:string){return !!user&&!!config?.actions[user.role]?.includes(action)}
export function canOperate(user:{role:string}|null|undefined,operation:Operation){return !!user&&(user.role==='owner'||!!config?.operations?.[user.role]?.includes(operation))}
export function canAccess(user:{role:string}|null|undefined,page:PageKey){return !!user&&!!config?.pages[user.role]?.includes(page)}
export const ROLE_LABELS:Record<string,string>={owner:'商家老板',manager:'店长',floor:'收银',technician:'技师',support:'平台协助',employee:'待授权员工'}
