import { parseServerConfig } from '@ayra/config';
parseServerConfig(process.env);
console.info(
  'AYRA worker foundation. Task execution is NOT IMPLEMENTED (M3). No jobs are accepted.',
);
const keepAlive = setInterval(() => {}, 60000);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    clearInterval(keepAlive);
  });
