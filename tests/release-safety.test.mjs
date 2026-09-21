import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signatureDecision} from '../scripts/signature-policy.mjs';
import {validateTestUrl} from '../scripts/check-test-database.mjs';
test('unknown, damaged or untrusted signatures cannot use the unsigned exception',()=>{
 for(const Status of ['UnknownError','HashMismatch','NotTrusted','NotSupported',''] ){
  for(const Subject of [null,'CN=ZA'])assert.equal(signatureDecision({Status,Subject},{allowUnsigned:true}),'reject');
 }
 assert.equal(signatureDecision({Status:'NotSigned',Subject:null}),'reject');
 assert.equal(signatureDecision({Status:'NotSigned',Subject:null},{allowUnsigned:true}),'unsigned-exception');
 assert.equal(signatureDecision({Status:'Valid',Subject:'CN=ZA'},{publisher:'OTHER'}),'reject');
 assert.equal(signatureDecision({Status:'Valid',Subject:'CN=ZA'},{publisher:'ZA'}),'valid');
});
test('database probe rejects production and wrong tunnel before opening a connection',()=>{
 for(const url of ['postgres://user@127.0.0.1:15433/za_spa_saas','postgres://user@139.196.162.194:5433/za_spa_saas_test','postgres://user@127.0.0.1:5433/za_spa_saas_test'])assert.throws(()=>validateTestUrl(url));
 assert.equal(validateTestUrl('postgres://user@127.0.0.1:15433/za_spa_saas_test'),'postgres://user@127.0.0.1:15433/za_spa_saas_test');
});
