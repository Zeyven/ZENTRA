import {readdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function schemaCheckSql(names){
 if(!names.length||names.some(n=>!/^\d{3}-[a-z0-9-]+\.sql$/.test(n)))throw Error('Invalid migration inventory');
 const expected=[...new Set(names)].sort().map(n=>`('${n}')`).join(',');
 return `\\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
DO $$
DECLARE missing text;
BEGIN
 SELECT string_agg(e.version, ', ' ORDER BY e.version) INTO missing
 FROM (VALUES ${expected}) AS e(version)
 WHERE NOT EXISTS (SELECT 1 FROM public.schema_migrations m WHERE m.version=e.version);
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Missing migrations: %', missing; END IF;
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stores' AND column_name='point_clock_business_type' AND data_type='text') THEN
  RAISE EXCEPTION 'Missing or invalid stores.point_clock_business_type';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.stores'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%point_clock_business_type%' AND pg_get_constraintdef(oid) LIKE '%BATH%' AND pg_get_constraintdef(oid) LIKE '%FOOT%') THEN
  RAISE EXCEPTION 'Missing point clock business type constraint';
 END IF;
 IF EXISTS (SELECT 1 FROM (VALUES ('hardware_bindings_one_room_per_gateway'),('hardware_bindings_one_ip_per_gateway'),('hardware_bindings_one_gateway_per_room')) AS e(name)
 WHERE NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname=e.name AND i.indrelid='public.hardware_bindings'::regclass AND i.indisunique AND i.indisvalid)) THEN
  RAISE EXCEPTION 'Missing valid unique hardware binding indexes';
 END IF;
END $$;
COMMIT;
`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const names=(await readdir(new URL('../apps/server/src/db/',import.meta.url))).filter(n=>/^\d.*\.sql$/.test(n));
 await writeFile(new URL('../.runtime/release-schema-check.sql',import.meta.url),schemaCheckSql(names));
 console.log(`Generated read-only release check for ${names.length} migrations`);
}
