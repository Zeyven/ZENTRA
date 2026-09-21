import pg from 'pg';
import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const url=process.env.MIGRATION_DATABASE_URL;if(!url)throw Error('MIGRATION_DATABASE_URL required');
assert(['za_spa_saas','za_spa_saas_test'].includes(new URL(url).pathname.slice(1)),'Refusing to migrate a database outside the new SaaS');
const c=new pg.Client({connectionString:url});await c.connect();
try{
 await c.query("SELECT pg_advisory_lock(hashtextextended('za-spa-saas:migrations',0))");
 await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
 const directory=fileURLToPath(new URL('../apps/server/src/db/',import.meta.url));
 for(const name of (await readdir(directory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
  if((await c.query('SELECT 1 FROM schema_migrations WHERE version=$1',[name])).rowCount)continue;
  await c.query('BEGIN');try{await c.query(await readFile(directory+'/'+name,'utf8'));await c.query('INSERT INTO schema_migrations(version) VALUES($1)',[name]);await c.query('COMMIT');console.log('APPLIED',name)}catch(e){await c.query('ROLLBACK');throw e}
 }
}finally{await c.end()}
