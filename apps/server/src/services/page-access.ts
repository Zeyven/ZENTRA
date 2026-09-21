import {ensure} from '../errors.js';
import type {Actor} from '../access.js';
const cashier=['board','orders'];
const operations=[...cashier,'technicians','clockroom','reservations','queue'];
export function routePages(path:string,method:string,role:string):string[]|null{
 const [head,part,action]=path.split('/').slice(1),read=method==='GET';
 if(['auth','session','permissions','realtime','stores','users','support'].includes(head))return null;
 if(head==='catalog')return ['headquarters'];
 if(head==='reports')return role==='technician'&&part==='technicians'?['technicians']:['reports'];
 if(head==='payroll')return ['reports'];
 if(['sessions','session-items','orders','order-groups'].includes(head))return cashier;
 if(head==='snapshot')return operations;
 if(head==='patrol'||head==='patrols')return ['board'];
 if(head==='members')return part==='search'?cashier:['members'];
 if(head==='coupons')return ['use','cancel-use'].includes(action??'')||read?['members',...cashier]:['members'];
 if(head==='coupon-profiles')return ['members'];
 if(['reservations','reservation-staff'].includes(head))return role==='technician'&&read?['technicians']:['reservations'];
 if(head==='queue')return ['queue'];
 if(head==='clocks')return ['technicians','clockroom',...cashier];
 if(head==='attendance')return ['technicians','clockroom','reports'];
 if(head==='technicians'&&action==='clock')return operations;
 if(head==='technicians'||head==='technician-skills')return read?[...operations,'settings']:['technicians','clockroom'];
 if(head==='rooms'||head==='wristbands')return read?[...operations,'settings']:['board','settings'];
 if(['items','categories'].includes(head))return read?[...operations,'items','settings']:['items'];
 if(['member-levels','recharge-plans'].includes(head))return read?['members','settings']:['settings'];
 if(['inventory','inventory-transfers','purchase-orders','service-consumables','suppliers','wine-storage'].includes(head))return ['items'];
 if(head==='shifts')return ['shift'];
 if(head==='settings')return part==='cashier'?cashier:['settings'];
 if(head==='marketing')return ['settings'];
 if(head==='integrations')return ['settings'];
 if(head==='devices')return part==='technician_announcer'?['settings','clockroom']:['settings'];
 if(head==='payments')return ['settings'];
 if(head==='booking-waitlist')return ['reservations'];
 if(head==='coupon-campaigns')return read||action==='invite'?['members','settings']:['settings'];
 if(['pricing-rules','commission-rules','audit-logs','audit-events'].includes(head))return ['settings'];
 if(head==='announcements')return read?null:['settings'];
 if(head==='approvals')return ['approvals'];
 if(head==='alerts')return operations;
 return [];
}
export function enforceRoutePages(actor:Actor,path:string,method:string){
 if(actor.role==='owner'||actor.role==='support')return;
 const required=routePages(path,method,actor.role);if(required===null)return;
 ensure(actor.storeId&&required.some(p=>actor.pages.includes(p)),403,'MODULE_FORBIDDEN','该门店未授权此功能，请联系商家老板');
}
export function visibleTopic(topic:string,actor:Actor){
 if(topic==='device.technician_announcer')return actor.role==='owner'||actor.role==='support'||actor.pages.some(page=>['clockroom','settings'].includes(page));
 if(topic.startsWith('marketing.'))return actor.role==='owner'||actor.role==='support'||actor.pages.includes('settings');
 if(actor.role==='owner'||actor.role==='support'||/^(access|stores|support|announcements)[.-]/.test(topic))return true;
 const domains:Array<[RegExp,string[]]>=[[/^(session|group-link|room)/,operations],[/^technician|^clock/,operations],[/^member|^coupon/,['members',...cashier]],[/^(reservation|booking)/,['reservations','technicians']],[/^queue/,['queue']],[/^shift/,['shift']],[/^payroll/,['reports']],[/^approval/,['approvals']],[/^(inventory|wine|suppliers|service-consumables)/,['items']],[/^(items|categories)/,[...operations,'items','settings']],[/^catalog[.]distributed/,[...operations,'items','members']],[/^(settings|pricing|commission|member_levels|recharge_plans|integration|device)/,['settings',...cashier,'members']]];
 return domains.some(([pattern,pages])=>pattern.test(topic)&&pages.some(p=>actor.pages.includes(p)));
}
