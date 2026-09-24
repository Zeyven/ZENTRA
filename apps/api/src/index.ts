import { parseServerConfig } from '@ayra/config';
import { createClerkIdentityProvider } from '@ayra/auth';
import pg from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
import { createApp } from './app';
const config = parseServerConfig(process.env);
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
const identity =
  config.CLERK_JWT_KEY && config.CLERK_AUTHORIZED_PARTIES
    ? createClerkIdentityProvider({
        jwtKey: config.CLERK_JWT_KEY,
        authorizedParties: config.CLERK_AUTHORIZED_PARTIES.split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      })
    : undefined;
const accessKeyId =
  config.OBJECT_STORE_ACCESS_KEY_ID ??
  (config.AYRA_ENV === 'development' ? process.env.MINIO_ROOT_USER : undefined);
const secretAccessKey =
  config.OBJECT_STORE_SECRET_ACCESS_KEY ??
  (config.AYRA_ENV === 'development' ? process.env.MINIO_ROOT_PASSWORD : undefined);
if (Boolean(accessKeyId) !== Boolean(secretAccessKey))
  throw new Error('Object store credentials must be configured together');
const objectClient = new S3Client({
  region: config.OBJECT_STORE_REGION,
  endpoint: config.OBJECT_STORE_ENDPOINT,
  forcePathStyle: true,
  ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
});
const app = await createApp({
  pool,
  ...(identity ? { identity } : {}),
  artifactAccess: { client: objectClient, bucket: config.OBJECT_STORE_BUCKET },
});
app.addHook('onClose', async () => {
  objectClient.destroy();
  await pool.end();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
  });
await app.listen({ host: config.API_HOST, port: config.API_PORT });
