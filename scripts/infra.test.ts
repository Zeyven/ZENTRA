import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { expect, it } from 'vitest';
it('keeps development infrastructure loopback-only and persists canonical services', () => {
  const config = parse(readFileSync('infrastructure/docker/compose.yaml', 'utf8'));
  for (const service of Object.values(config.services) as { ports?: string[] }[])
    for (const port of service.ports ?? []) expect(port).toMatch(/^127\.0\.0\.1:/);
  expect(config.services.postgres.image).toMatch(/^postgres:18\./);
  expect(config.services.temporal.command).toContain('--db-filename');
  expect(config.services.redis.command).toContain('no');
});
