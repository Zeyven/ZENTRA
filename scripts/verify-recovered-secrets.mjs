import {readFile,writeFile} from 'node:fs/promises';
import {createDecipheriv} from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import assert from 'node:assert/strict';
const key=await readFile('.runtime/production-recovery.key'),encrypted=await readFile('.runtime/production-recovery.enc');
const decipher=createDecipheriv('aes-256-gcm',key,encrypted.subarray(0,12));decipher.setAAD(Buffer.from('za-spa-saas-recovery:v1'));decipher.setAuthTag(encrypted.subarray(-16));
const restored=JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(12,-16)),decipher.final()]).toString());
const env=Object.fromEntries(restored.environment.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)]}));assert.equal(new URL(env.DATABASE_URL).pathname,'/za_spa_saas');
const c=new pg.Client({connectionString:env.DATABASE_URL.replace(':5433/',':15433/')});await c.connect();try{assert.equal((await c.query('SELECT current_user u')).rows[0].u,'saas_app')}finally{await c.end()}
const response=await fetch('https://saas.zephael.cn/api/platform/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(restored.platform_account)});const payload=await response.json();assert(response.ok&&payload.ok);
assert.equal(jwt.verify(payload.data.token,env.PLATFORM_JWT_SECRET,{algorithms:['HS256'],audience:'platform',issuer:'za-spa-saas'}).realm,'platform');
assert.equal(Buffer.from(env.AUTH_ENCRYPTION_KEY,'hex').length,32);assert.notEqual(env.PLATFORM_JWT_SECRET,env.MERCHANT_JWT_SECRET);
const result={decrypted_database_login_verified:true,decrypted_platform_login_verified:true,recovered_jwt_verified:true,independent_encryption_key_present:true,checked_at:new Date().toISOString()};await writeFile('.runtime/recovery-secrets-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
