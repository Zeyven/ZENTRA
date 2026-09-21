export const businessPages = ['board','orders','technicians','clockroom','items','members','reservations','queue','reports','shift','settings','approvals'] as const;
export const sensitiveActions = ['settle','reverseSettle','discount','refund','gift','cancel','recharge','adjust','userManage','export','import','approve'] as const;
export const defaultPages: Record<string,string[]> = {
 owner:[...businessPages,'organization','headquarters'],
 manager:[...businessPages],
 floor:['board','orders','members','reservations','queue','shift','approvals'],
 technician:['technicians'],
 support:[...businessPages],employee:[]
};
export const defaultActions: Record<string,string[]> = {
 owner:[...sensitiveActions],manager:['settle','discount','gift','recharge','export','approve'],floor:['settle','recharge'],technician:[],support:[],employee:[]
};

// Role ceilings describe capabilities the server actually supports; defaults are a subset.
export const actionCeilings:Record<string,string[]>={
 owner:[...sensitiveActions],manager:sensitiveActions.filter(a=>!['userManage','import'].includes(a)),
 floor:['settle','discount','refund','gift','cancel','recharge'],technician:[],support:[],employee:[]
};
export const operationLabels={openOrder:'开房',orderEdit:'加项目 / 换房 / 挂单并单',addTime:'按项目价格加钟',finishService:'落钟 / 结束服务',assignTechnician:'派钟 / 换技师',clockOperate:'报钟 / 暂停恢复 / 考勤',roomStatus:'打扫 / 房态维护',memberManage:'会员资料维护',reservationManage:'预约登记与变更',queueManage:'取号 / 叫号 / 取消',shiftManage:'开班 / 交班',settingsManage:'门店经营配置',catalogManage:'房间 / 项目 / 会员方案配置',inventoryManage:'采购 / 库存 / 调拨',technicianManage:'技师档案 / 技能配置',announcementManage:'公告维护'} as const;
export const actionPages:Record<string,string[]>={settle:['board','orders'],reverseSettle:['board','orders','members'],discount:['board','orders','members','settings'],refund:['board','orders','members'],gift:['board','orders'],cancel:['board','orders'],recharge:['members'],adjust:['members','items'],export:['reports','members','orders','items'],approve:['approvals']};
export type Operation=keyof typeof operationLabels;
const cashPages=['board','orders'];
export const operationPages:Record<Operation,string[]>={openOrder:[...cashPages,'reservations'],orderEdit:cashPages,addTime:[...cashPages,'technicians','clockroom'],finishService:[...cashPages,'technicians','clockroom'],assignTechnician:cashPages,clockOperate:[...cashPages,'technicians','clockroom'],roomStatus:['board','settings'],memberManage:['members'],reservationManage:['reservations'],queueManage:['queue'],shiftManage:['shift'],settingsManage:['settings','clockroom','technicians','reports'],catalogManage:['settings','items'],inventoryManage:['items'],technicianManage:['technicians','clockroom'],announcementManage:['settings']};
export const defaultOperations:Record<string,Operation[]>={
 owner:Object.keys(operationLabels) as Operation[],manager:Object.keys(operationLabels) as Operation[],
 floor:['openOrder','orderEdit','addTime','finishService','assignTechnician','clockOperate','roomStatus','memberManage','reservationManage','queueManage','shiftManage'],
 technician:['clockOperate','finishService'],support:['settingsManage','catalogManage','technicianManage','roomStatus'],employee:[]
};
export function effectiveOperations(role:string,pages:string[],selected?:string[]|null):Operation[]{return (defaultOperations[role]??[]).filter(key=>(selected==null||selected.includes(key))&&operationPages[key].some(page=>pages.includes(page)))}
export function routeOperation(path:string,method:string):Operation|null{
 if(method==='GET'||method==='HEAD')return null;
 const [head,id,action]=path.split('/').slice(1);
 if(head==='sessions'){if(!id)return 'openOrder';if(action==='items')return 'orderEdit';if(['bind-member','change-room','suspend','resume'].includes(action))return 'orderEdit'}
 if(head==='session-items')return ({'add-time':'addTime',end:'finishService',technician:'assignTechnician'} as Record<string,Operation>)[action]??null;
 if(head==='order-groups')return 'orderEdit';
 if(head==='coupons'&&['use','cancel-use'].includes(action))return 'orderEdit';
 if(head==='clocks'){if(id==='settings')return 'settingsManage';if(action==='finish')return 'finishService';if(action==='add-time')return 'addTime';return 'clockOperate'}
 if(head==='rooms'&&action==='status')return 'roomStatus';
 if(head==='patrol'||head==='patrols')return 'roomStatus';
 if(head==='payroll')return 'settingsManage';
 if(head==='technicians')return action==='clock'?'clockOperate':'technicianManage';
 if(['rooms','wristbands','items','categories','member-levels','recharge-plans','pricing-rules','coupon-profiles'].includes(head))return 'catalogManage';
 if(head==='members'&&(!id||!action&&method==='DELETE'||action==='status'))return 'memberManage';
 if(head==='reservations')return action==='arrive-open'?'openOrder':'reservationManage';
 if(head==='booking-waitlist')return 'reservationManage';
 if(head==='queue')return 'queueManage';
 if(head==='shifts')return 'shiftManage';
 if(['settings','devices','integrations','payments','commission-rules'].includes(head))return 'settingsManage';
 if(['inventory','inventory-transfers','purchase-orders','service-consumables','suppliers','wine-storage'].includes(head))return 'inventoryManage';
 if(head==='announcements')return 'announcementManage';
 return null;
}
