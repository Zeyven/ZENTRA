import assert from 'node:assert/strict';
assert.equal(process.env.NODE_ENV,'test');assert.equal(new URL(process.env.DATABASE_URL!).pathname,'/za_spa_saas_test');
process.env.PORT='8792';process.env.PUBLIC_ORIGIN='http://127.0.0.1:5175';
await import('../apps/server/src/index.js');
