import { parseServerConfig } from '@ayra/config';
import { createClerkIdentityProvider } from '@ayra/auth';
import pg from 'pg';
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
const app = await createApp({ pool, ...(identity ? { identity } : {}) });
app.addHook('onClose', async () => {
  await pool.end();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
  });
await app.listen({ host: config.API_HOST, port: config.API_PORT });
