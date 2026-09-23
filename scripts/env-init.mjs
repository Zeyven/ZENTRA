import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
if (existsSync('.env.local')) {
  console.info('.env.local already exists; preserved without changes.');
} else {
  const secret = () => randomBytes(32).toString('hex');
  const appPassword = secret();
  const values = {
    POSTGRES_PASSWORD: secret(),
    APPLICATION_DB_PASSWORD: appPassword,
    MINIO_ROOT_PASSWORD: secret(),
    DATABASE_URL: `postgresql://application_role:${appPassword}@127.0.0.1:5432/ayra`,
  };
  const template = readFileSync('.env.example', 'utf8');
  const output = template
    .split('\n')
    .map((line) => {
      const key = line.split('=')[0];
      return Object.hasOwn(values, key) ? `${key}=${values[key]}` : line;
    })
    .join('\n');
  writeFileSync('.env.local', output, { mode: 0o600, flag: 'wx' });
  console.info('Created ignored .env.local with random local credentials.');
}
