import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {assertActionResult}=createRequire(import.meta.url)('../apps/client/src/renderer/src/utils/action-result.ts');
test('shared action feedback rejects returned failures without inventing success',()=>{
 for(const value of [undefined,null,{ok:true},[]])assert.doesNotThrow(()=>assertActionResult(value));
 assert.throws(()=>assertActionResult({ok:false,msg:'权限不足',code:'FORBIDDEN'}),{message:'权限不足',code:'FORBIDDEN'});
 assert.throws(()=>assertActionResult({ok:false,msg:'网络中断',code:'RESULT_UNKNOWN'}),/核对原请求/);
 assert.throws(()=>assertActionResult({ok:false,msg:{private:'invalid'}}),{message:'操作失败，请核对后重试'});
});
