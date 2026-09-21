import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {signatureDecision} from './signature-policy.mjs';

const GUIDANCE=`发布前必须完成 Windows 代码签名，否则安装包不得上线：
  1) 获取证书：购买 Windows 代码签名证书（OV 或 EV，正式发布通常要求 EV），或改用 Azure Trusted Signing；自签名证书不被信任，不能用于正式发布。
  2) 配置发布者：在 apps/client/electron-builder.yml 的 win: 下填写 publisherName（值为证书 Subject 中的组织名）。
  3) 提供签名材料（不要提交进仓库）：设置环境变量 CSC_LINK 与 CSC_KEY_PASSWORD，或使用 win.certificateFile / win.certificatePassword（Azure Trusted Signing 用 azureSignOptions）。
  4) 强制门禁：证书就绪后启用顶层 forceCodeSigning: true（该键当前以注释形式保留在 electron-builder.yml）。
  仅本地/内测可用 --allow-unsigned 放行（发布脚本需显式设置 ZA_ALLOW_UNSIGNED=1）；正式发布不得使用。`;

const query=`$ErrorActionPreference='Stop'
$signature=Get-AuthenticodeSignature -LiteralPath $env:ZA_SIGN_TARGET
[pscustomobject]@{Status=$signature.Status.ToString();Subject=$signature.SignerCertificate.Subject;Thumbprint=$signature.SignerCertificate.Thumbprint;Timestamp=$signature.TimeStamperCertificate.Subject}|ConvertTo-Json -Compress`;

function parseArgs(argv){
 const files=[],options={publisher:'',allowUnsigned:false};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--allow-unsigned')options.allowUnsigned=true;
  else if(arg==='--publisher')options.publisher=argv[++i]??'';
  else if(arg.startsWith('--publisher='))options.publisher=arg.slice('--publisher='.length);
  else if(arg.startsWith('--'))throw Error('未知参数：'+arg);
  else files.push(arg);
 }
 return {files,options};
}

function readSignature(file){
 const result=spawnSync('powershell',['-NoProfile','-NonInteractive','-Command',query],{encoding:'utf8',env:{...process.env,ZA_SIGN_TARGET:file}});
 if(result.error)throw Error('无法调用 PowerShell 读取签名：'+(result.error.message||result.error));
 if(result.status!==0)throw Error(`读取签名失败（PowerShell 退出码 ${result.status}）：${(result.stderr||'').trim()}`);
 const text=(result.stdout||'').trim();
 return text?JSON.parse(text):{Status:'NotSigned',Subject:null,Thumbprint:null,Timestamp:null};
}

let parsed;
try{parsed=parseArgs(process.argv.slice(2))}catch(error){console.error(error.message+'\n'+GUIDANCE);process.exit(2)}
const {files,options}=parsed;
if(!files.length){console.error('用法：node scripts/verify-code-signing.mjs <安装包...> [--publisher <名称>] [--allow-unsigned]\n'+GUIDANCE);process.exit(2)}

let failures=0;
for(const raw of files){
 const file=resolve(raw);
 if(!existsSync(file)){console.error(`✗ 找不到安装包：${file}`);failures++;continue}
 let signature;
 try{signature=readSignature(file)}catch(error){console.error(`✗ ${error.message}`);failures++;continue}
 const decision=signatureDecision(signature,options);
 if(decision==='unsigned-exception'){console.warn(`! 未签名，已按 --allow-unsigned 放行：${file}`);continue}
 if(decision==='reject'){console.error(`✗ 签名未通过（状态 ${signature.Status}，发布者须符合预期）：${file}`);failures++;continue}
 console.log(`✓ 已签名：${file}\n  状态：${signature.Status}\n  主体：${signature.Subject}\n  指纹：${signature.Thumbprint||'（无）'}\n  时间戳：${signature.Timestamp||'（无时间戳）'}`);
}
if(failures){console.error(`代码签名校验未通过：${failures}/${files.length} 个安装包。\n${GUIDANCE}`);process.exit(1)}
