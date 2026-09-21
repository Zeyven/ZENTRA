import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoginRegSn} from './vendor-login.mjs';

test('vendor login signature matches independently calculated binary algorithm fixture',()=>{
 assert.equal(createLoginRegSn('0123456789abcdef0123456789abcdef','2026-09-15 10:00:00'),'a35599c179469eb32c0d5a47747f5483');
});

test('vendor login signature rejects missing authorization and malformed datetime',()=>{
 assert.throws(()=>createLoginRegSn('short','2026-09-15 10:00:00'));
 assert.throws(()=>createLoginRegSn('0123456789abcdef0123456789abcdef','2026/09/15'));
});
