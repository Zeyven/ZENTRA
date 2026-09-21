import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const {assetPath,allowedNetwork}=createRequire(import.meta.url)('../apps/client/src/main/security.ts');
test('桌面资源路径限定打包目录，拒绝编码路径穿越和平台入口',()=>{
 const root=resolve('apps/client/out/renderer');assert.equal(assetPath(root,'zaspa-saas://app/'),resolve(root,'index.html'));assert.equal(assetPath(root,'zaspa-saas://app/assets/index.js'),resolve(root,'assets/index.js'));
 for(const url of ['zaspa-saas://app/platform','zaspa-saas://evil/assets/x.js','zaspa-saas://app/assets/%2e%2e/%2e%2e/package.json','zaspa-saas://app/assets/..%5c..%5csecret','zaspa-saas://app/assets/%00','file:///C:/private'])assert.equal(assetPath(root,url),null,url);
});
test('桌面网络只接受新 SaaS 商家接口和对应实时通道',()=>{
 assert.equal(allowedNetwork('https://saas.zephael.cn/api/merchant/v1/auth/login'),true);assert.equal(allowedNetwork('wss://saas.zephael.cn/socket.io/?EIO=4'),true);
 for(const url of ['https://www.zephael.cn/api/merchant/v1/auth/login','https://saas.zephael.cn/api/platform/v1/auth/login','http://saas.zephael.cn/api/merchant/v1/auth/login','https://saas.zephael.cn.evil.test/api/merchant/v1/auth/login','https://saas.zephael.cn:8443/api/merchant/v1/auth/login'])assert.equal(allowedNetwork(url),false,url);
});
