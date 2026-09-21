import {createLoginRegSn} from './vendor-login.mjs';
import {buildPointClockMenuJson,selectPointClockMenuFragments} from './vendor-menu.mjs';

const DEVICE_ID=/^[0-9a-f]{32}$/i;

export function vendorDateTime(date=new Date()){
 if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw Error('Invalid point-clock login time');
 const p=n=>String(n).padStart(2,'0');
 return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function createVendorDeviceLogin({deviceId,roomName,businessType,runtime,date=new Date()}){
 if(!DEVICE_ID.test(deviceId)||typeof roomName!=='string'||!roomName.trim()||roomName.length>100)throw Error('Invalid point-clock binding');
 if(!runtime?.registrations?.get||!Array.isArray(runtime.resources)||typeof runtime.tenantName!=='string'||typeof runtime.servicePhone!=='string')throw Error('Invalid vendor runtime');
 const registrationCode=runtime.registrations.get(deviceId);if(!registrationCode)throw Error('Point-clock vendor authorization is missing');
 const datetime=vendorDateTime(date);
 // Vendor logs contain the pre-replacement "MenuArray" placeholder. The
 // actual send path replaces its quoted JSON value with an array (0x92289a).
 const menu=JSON.parse(buildPointClockMenuJson(selectPointClockMenuFragments(runtime.resources,businessType)));
 return {code:1,msg:'成功',data:{
  company:runtime.tenantName,datetime,exittime:20,freshtime:30,mainmenu:{},menu,
  outtime:10,regsn:createLoginRegSn(registrationCode,datetime),roomname:roomName,
  support:runtime.servicePhone,welcome:runtime.tenantName
 }};
}

export function validatePointClockVendorRuntime(runtime,businessType,deviceIds){
 if(!Array.isArray(deviceIds)||!deviceIds.length||deviceIds.some(id=>!DEVICE_ID.test(id)||!runtime?.registrations?.get(id)))throw Error('Point-clock vendor authorization is incomplete');
 buildPointClockMenuJson(selectPointClockMenuFragments(runtime.resources,businessType));
}
