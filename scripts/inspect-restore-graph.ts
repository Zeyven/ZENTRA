import pg from 'pg';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
try{
 const rows=(await client.query("SELECT conrelid::regclass::text AS child,confrelid::regclass::text AS parent FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace")).rows;
 const pending=new Set<string>(rows.flatMap(r=>[r.child,r.parent])),ordered:string[]=[];
 while(pending.size){const ready=[...pending].filter(t=>!rows.some(r=>r.child===t&&r.parent!==t&&pending.has(r.parent)));if(!ready.length)break;for(const t of ready){ordered.push(t);pending.delete(t)}}
 console.log(JSON.stringify({ordered,cycles:rows.filter(r=>r.child!==r.parent&&pending.has(r.child)&&pending.has(r.parent))},null,2));
}finally{await client.end()}
