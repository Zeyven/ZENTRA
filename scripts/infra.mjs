import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const action = process.argv[2];
if (!['up', 'down', 'verify'].includes(action)) throw new Error('Expected up, down, or verify');
const available = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (available.error || available.status !== 0) {
  console.error(
    'Docker daemon is unavailable. Install/start Docker Desktop or a compatible Docker engine, then retry. Infrastructure is NOT VERIFIED.',
  );
  process.exit(1);
}
if (!existsSync('.env.local')) throw new Error('Run pnpm env:init first');
const base = [
  'compose',
  '--project-name',
  'ayra-local',
  '--env-file',
  '.env.local',
  '-f',
  'infrastructure/docker/compose.yaml',
];
function run(args, capture = false) {
  const result = spawnSync('docker', [...base, ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0) {
    console.error('Infrastructure command failed; credentials and command output suppressed.');
    process.exit(1);
  }
  return result.stdout?.trim();
}
if (action === 'up') run(['up', '-d', '--wait', '--wait-timeout', '180']);
if (action === 'down') run(['down']); // Deliberately preserves data volumes.
if (action === 'verify') {
  const version = run(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'migration_role',
      '-d',
      'ayra',
      '-Atc',
      "SELECT current_setting('server_version_num')::int >= 180000 AND current_setting('server_version_num')::int < 190000",
    ],
    true,
  );
  if (version !== 't') throw new Error('PostgreSQL 18 check failed');
  const role = run(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'migration_role',
      '-d',
      'ayra',
      '-Atc',
      "SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole FROM pg_roles WHERE rolname = 'application_role'",
    ],
    true,
  );
  if (role !== 't') throw new Error('Application role safety check failed');
  const login = run(
    [
      'exec',
      '-T',
      'postgres',
      'sh',
      '-ec',
      'PGPASSWORD="$APPLICATION_DB_PASSWORD" psql -h 127.0.0.1 -U application_role -d ayra -Atc "SELECT current_user"',
    ],
    true,
  );
  if (login !== 'application_role') throw new Error('Application database login failed');

  if (run(['exec', '-T', 'redis', 'redis-cli', 'ping'], true) !== 'PONG')
    throw new Error('Redis health check failed');
  run(
    [
      'exec',
      '-T',
      'temporal',
      'temporal',
      'operator',
      'cluster',
      'health',
      '--address',
      '127.0.0.1:7233',
    ],
    true,
  );
  run(
    [
      'exec',
      '-T',
      'temporal',
      'temporal',
      'operator',
      'namespace',
      'describe',
      '--namespace',
      'ayra-development',
      '--address',
      '127.0.0.1:7233',
    ],
    true,
  );
  run(['run', '--rm', 'object-store-init'], true);
  console.info(
    'PASS: PostgreSQL 18, application role, Redis, Temporal namespace, S3 put/get/delete.',
  );
}
