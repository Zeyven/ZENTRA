import {readVendorRuntime} from './vendor-runtime.mjs';
import {validatePointClockVendorRuntime} from './vendor-device-login.mjs';

const DEVICE_ID=/^[0-9a-f]{32}$/i;

// Both the managed Electron gateway and the documented command-line gateway
// must make the same decision. This never contacts a vendor service: it only
// reads the existing local cache after the ZA Thera gateway session is valid.
export async function loadVendorSession(session,devices,readRuntime=readVendorRuntime){
 const deviceIds=devices.map(device=>device.deviceId);
 if(!['BATH','FOOT'].includes(session?.point_clock_business_type))return {vendor:null,message:'；请先配置门店点钟王业态'};
 if(!deviceIds.length||deviceIds.some(deviceId=>!DEVICE_ID.test(deviceId)))return {vendor:null,message:'；设备编号不是原厂32位编号，点钟王登录未启用'};
 try{
  const runtime=await readRuntime(deviceIds);
  validatePointClockVendorRuntime(runtime,session.point_clock_business_type,deviceIds);
  return {vendor:{businessType:session.point_clock_business_type,runtime},message:'，已自动载入原厂点钟王授权和菜单'};
 }catch{
  return {vendor:null,message:'；原厂授权或当前业态的菜单不完整，点钟王登录未启用'};
 }
}
