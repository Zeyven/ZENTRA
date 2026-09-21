import pg from 'pg';
import assert from 'node:assert/strict';
const url=process.env.MIGRATION_DATABASE_URL!;assert.equal(new URL(url).pathname,'/za_spa_saas');
const c=new pg.Client({connectionString:url});await c.connect();
try{const counts:any={};for(const table of ['merchants','platform_users','merchant_users','orders','payments','members'])counts[table]=Number((await c.query('SELECT count(*) n FROM '+table)).rows[0].n);const versions=(await c.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(r=>r.version);console.log(JSON.stringify({database:'za_spa_saas',counts,migrations:versions}));assert.equal(counts.merchants,0,'Do not run launch initialization over existing merchants');}
finally{await c.end()}
