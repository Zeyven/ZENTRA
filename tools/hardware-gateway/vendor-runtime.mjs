import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {parseVendorResources} from './vendor-menu.mjs';

const DEVICE_ID=/^[0-9a-f]{32}$/i;
const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$ids=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ZA_THERA_VENDOR_DEVICE_IDS))|ConvertFrom-Json
$hard=Get-Item -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Eissoft\HARD' -ErrorAction Stop
$tenantName=[string]$hard.GetValue('TenantName',$null,'DoNotExpandEnvironmentNames')
$servicePhone=[string]$hard.GetValue('ServicePhone',$null,'DoNotExpandEnvironmentNames')
if(-not $tenantName){throw 'Vendor tenant name is missing'}
$cache=Get-Item -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Eissoft\HARD\Cache' -ErrorAction Stop
$menu=[string]$cache.GetValue('SaasTenantResource',$null,'DoNotExpandEnvironmentNames')
if(-not $menu){throw 'Vendor menu cache is missing'}
$local=Get-Item -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Eissoft\HARD\LOCAL' -ErrorAction Stop
$registrations=@{}
foreach($id in $ids){$value=[string]$local.GetValue([string]$id,$null,'DoNotExpandEnvironmentNames');if($value.Length -eq 32){$registrations[[string]$id]=$value}}
@{menu=$menu;registrations=$registrations;tenantName=$tenantName;servicePhone=$servicePhone}|ConvertTo-Json -Depth 3 -Compress
`;

export function parseVendorRuntimeOutput(output,expectedDeviceIds){
 const expected=new Set(expectedDeviceIds);if(!expected.size||[...expected].some(id=>!DEVICE_ID.test(id)))throw Error('Invalid vendor device identifiers');
 if(typeof output!=='string'||Buffer.byteLength(output)>8*1024*1024)throw Error('Invalid vendor runtime output');
 const value=JSON.parse(output.replace(/^\uFEFF/,''));if(!value||typeof value.menu!=='string'||!value.registrations||typeof value.registrations!=='object'||Array.isArray(value.registrations)||typeof value.tenantName!=='string'||!value.tenantName.trim()||value.tenantName.length>200||typeof value.servicePhone!=='string'||value.servicePhone.length>200)throw Error('Invalid vendor runtime output');
 const registrations=new Map();for(const [id,code] of Object.entries(value.registrations)){if(!expected.has(id)||!DEVICE_ID.test(id)||typeof code!=='string'||code.length!==32||/[\x00-\x1f\x7f]/.test(code))throw Error('Invalid vendor registration cache');registrations.set(id,code)}
 if(registrations.size!==expected.size)throw Error('One or more point-clock devices are not authorized by the vendor');
 return {resources:parseVendorResources(value.menu),registrations,tenantName:value.tenantName,servicePhone:value.servicePhone};
}

export async function readVendorRuntime(deviceIds){
 if(process.platform!=='win32')throw Error('Vendor point-clock cache is only available on Windows');
 const ids=[...new Set(deviceIds)];if(!ids.length||ids.some(id=>!DEVICE_ID.test(id)))throw Error('Point-clock device identifiers must be 32 hexadecimal characters');
 const encoded=Buffer.from(JSON.stringify(ids),'utf8').toString('base64');
 const executable=join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const output=await new Promise((resolve,reject)=>execFile(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:10000,maxBuffer:8*1024*1024,encoding:'utf8',env:{SystemRoot:process.env.SystemRoot??'C:\\Windows',ZA_THERA_VENDOR_DEVICE_IDS:encoded}},(error,stdout)=>error?reject(Error('Vendor point-clock authorization/cache is unavailable')):resolve(stdout)));
 return parseVendorRuntimeOutput(output,ids);
}
