import { z } from 'zod';
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  AYRA_ENV: z.enum(['development', 'test', 'staging', 'production']),
  AYRA_BASE_URL: z.url(),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url().refine((value) => {
    const u = new URL(value);
    return (
      ['postgres:', 'postgresql:'].includes(u.protocol) &&
      decodeURIComponent(u.username) === 'application_role'
    );
  }, 'Application traffic requires application_role'),
  REDIS_URL: z.url().refine((v) => ['redis:', 'rediss:'].includes(new URL(v).protocol)),
  TEMPORAL_ADDRESS: z.string().regex(/^[a-zA-Z0-9.-]+:\d+$/),
  TEMPORAL_NAMESPACE: z.string().min(1),
  OBJECT_STORE_ENDPOINT: z.url(),
  OBJECT_STORE_BUCKET: z.string().min(1),
});
export function parseServerConfig(env: Record<string, string | undefined>) {
  const result = serverSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid server configuration: ${[...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ')}`,
    );
  return Object.freeze(result.data);
}
/** Explicit allowlist. Never serialize server configuration to a client. */
export function publicConfig(env: Record<string, string | undefined>) {
  const value = env.NEXT_PUBLIC_AYRA_API_URL;
  return value ? { apiUrl: z.url().parse(value) } : {};
}
