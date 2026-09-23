import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import type { IdentityProvider } from '@ayra/auth';
import type { Pool } from 'pg';
import { registerWorkspaceRoutes } from './workspaces';
import { registerProjectRoutes } from './projects';
export async function createApp(services: { identity?: IdentityProvider; pool?: Pool } = {}) {
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 1048576,
  });
  await app.register(swagger, {
    openapi: { info: { title: 'AYRA Control Plane', version: '0.0.0' } },
  });
  app.get(
    '/health/live',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', const: 'ok' },
              service: { type: 'string', const: 'ayra-api' },
            },
            required: ['status', 'service'],
            additionalProperties: false,
          },
        },
      },
    },
    async () => ({ status: 'ok', service: 'ayra-api' }),
  );
  app.get('/health/ready', async (_req, reply) =>
    reply.code(503).send({
      status: 'not_ready',
      reason: 'AYRA business capabilities are not release-ready',
    }),
  );
  registerWorkspaceRoutes(app, services);
  registerProjectRoutes(app, services);
  app.get('/openapi.json', async () => app.swagger());
  return app;
}
