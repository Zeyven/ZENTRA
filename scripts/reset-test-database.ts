import pg from 'pg';
import assert from 'node:assert/strict';
const url=process.env.MIGRATION_DATABASE_URL;
assert(url,'MIGRATION_DATABASE_URL required');
assert.equal(process.env.NODE_ENV,'test','Only the isolated test database may be reset');
assert.equal(new URL(url).pathname,'/za_spa_saas_test','Refusing any other database');
const client=new pg.Client({connectionString:url});await client.connect();
try{
 assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name,'za_spa_saas_test');
 await client.query('DROP SCHEMA public CASCADE');
 await client.query('CREATE SCHEMA public AUTHORIZATION saas_migrator');
 console.log('Reset isolated SaaS test schema only');
}finally{await client.end()}
