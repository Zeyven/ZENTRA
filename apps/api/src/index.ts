import { parseServerConfig } from '@ayra/config';
import { createApp } from './app';
const config = parseServerConfig(process.env);
const app = await createApp();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
  });
await app.listen({ host: config.API_HOST, port: config.API_PORT });
