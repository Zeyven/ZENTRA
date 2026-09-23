import { describe, expect, it } from 'vitest';
import { parseServerConfig, publicConfig } from './index';
const env = {
  NODE_ENV: 'test',
  AYRA_ENV: 'test',
  AYRA_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://application_role:test@localhost:5432/ayra',
  REDIS_URL: 'redis://localhost:6379',
  TEMPORAL_ADDRESS: 'localhost:7233',
  TEMPORAL_NAMESPACE: 'ayra-development',
  OBJECT_STORE_ENDPOINT: 'http://localhost:9000',
  OBJECT_STORE_BUCKET: 'ayra-development',
};
describe('server configuration', () => {
  it('accepts valid application configuration', () => {
    expect(parseServerConfig(env).API_PORT).toBe(4000);
  });
  it('fails fast for missing required configuration', () => {
    expect(() => parseServerConfig({})).toThrow('Invalid server configuration');
  });
  it.each(['migration_role', 'postgres', 'readonly_ops_role'])(
    'rejects privileged or wrong database role %s',
    (role) => {
      expect(() =>
        parseServerConfig({ ...env, DATABASE_URL: `postgresql://${role}:secret@localhost/ayra` }),
      ).toThrow('DATABASE_URL');
    },
  );
  it('does not leak rejected credentials in configuration errors', () => {
    try {
      parseServerConfig({
        ...env,
        DATABASE_URL: 'postgresql://migration_role:DO_NOT_LOG@localhost/ayra',
      });
      throw new Error('Expected validation failure');
    } catch (error) {
      expect(String(error)).toContain('DATABASE_URL');
      expect(String(error)).not.toContain('DO_NOT_LOG');
    }
  });
  it('never exposes arbitrary server configuration to clients', () => {
    expect(
      publicConfig({
        ...env,
        OPENAI_API_KEY: 'secret',
        NEXT_PUBLIC_AYRA_API_URL: 'https://api.example.com',
      }),
    ).toEqual({ apiUrl: 'https://api.example.com' });
  });
});
