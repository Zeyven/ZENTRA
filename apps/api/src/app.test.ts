import { describe, expect, it } from 'vitest';
import { createApp } from './app';
describe('control plane foundation', () => {
  it('exposes liveness without claiming business readiness', async () => {
    const app = await createApp();
    try {
      const live = await app.inject({ method: 'GET', url: '/health/live' });
      expect(live.statusCode).toBe(200);
      expect(live.json()).toEqual({ status: 'ok', service: 'ayra-api' });
      expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(503);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/tasks/00000000-0000-4000-8000-000000000001/start',
            headers: { 'idempotency-key': 'start-disabled' },
            payload: { version: 1 },
          })
        ).json(),
      ).toEqual({ error: 'task_execution_unavailable' });
      expect(
        (await app.inject({ method: 'POST', url: '/v1/tasks', payload: { goal: 'run shell' } }))
          .statusCode,
      ).toBe(400);
      const schema = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
      expect(schema.openapi).toMatch(/^3\./);
      expect(schema.paths['/health/live']).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
