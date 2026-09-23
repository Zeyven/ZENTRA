import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = 'infrastructure/migrations';
const container = 'ayra-local-postgres-1';
function sql(input, capture = false) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-A',
      '-t',
      '-U',
      'migration_role',
      '-d',
      'ayra',
    ],
    { input, encoding: 'utf8', stdio: ['pipe', capture ? 'pipe' : 'ignore', 'ignore'] },
  );
  if (result.error || result.status !== 0)
    throw new Error('Database migration command failed; SQL and credentials suppressed.');
  return result.stdout?.trim();
}

sql(`
  CREATE SCHEMA IF NOT EXISTS ayra;
  CREATE TABLE IF NOT EXISTS ayra.schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`);

for (const file of readdirSync(directory)
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort()) {
  const source = readFileSync(join(directory, file), 'utf8');
  const checksum = createHash('sha256').update(source).digest('hex');
  const applied = sql(
    `SELECT checksum FROM ayra.schema_migrations WHERE version = '${file}';`,
    true,
  );
  if (applied) {
    if (applied !== checksum) throw new Error(`Migration ${file} changed after application.`);
    console.info(`Already applied: ${file}`);
    continue;
  }
  sql(
    `BEGIN;\n${source}\nINSERT INTO ayra.schema_migrations(version, checksum) VALUES ('${file}', '${checksum}');\nCOMMIT;`,
  );
  console.info(`Applied: ${file}`);
}
