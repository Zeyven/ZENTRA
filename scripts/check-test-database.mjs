import pg from 'pg';
import {pathToFileURL} from 'node:url';

export function validateTestUrl(value){
 const url=new URL(value);
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='15433'||decodeURIComponent(url.pathname)!=='/za_spa_saas_test')throw Error('Test database must be loopback port 15433 / za_spa_saas_test');
 return value;
}
export async function check(){
 for(const key of ['DATABASE_URL','PLATFORM_DATABASE_URL']){
  const connectionString=validateTestUrl(process.env[key]??'');
  const client=new pg.Client({connectionString,connectionTimeoutMillis:5000,query_timeout:5000});
  try{
   await client.connect();
   const {rows}=await client.query('SELECT current_database() AS name, 1 AS reachable');
   if(rows[0]?.name!=='za_spa_saas_test'||rows[0]?.reachable!==1)throw Error('Unexpected database identity');
  }finally{await client.end();}
 }
 console.log('Both test database connections verified: za_spa_saas_test');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 check().catch(()=>{console.error('Test database verification failed; check the tunnel and private test configuration. No credentials printed.');process.exitCode=1;});
}
