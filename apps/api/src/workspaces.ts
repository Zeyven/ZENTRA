import { workspacePolicy } from '@ayra/auth';
import type { WorkspaceId } from '@ayra/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthorizedWork, Services } from './request-context';
import { runAuthorized } from './request-context';

export function registerWorkspaceRoutes(app: FastifyInstance, services: Services) {
  async function run<T>(request: FastifyRequest, reply: FastifyReply, work: AuthorizedWork<T>) {
    return runAuthorized(services, request, reply, work);
  }

  app.get('/v1/account', async (request, reply) =>
    run(request, reply, async (client, actor) => {
      const account = await client.query<{ id: string; display_name: string }>(
        'SELECT id, display_name FROM users WHERE id = $1',
        [actor],
      );
      const row = account.rows[0];
      if (!row) return reply.code(404).send({ error: 'account_not_found' });
      return { id: row.id, displayName: row.display_name };
    }),
  );

  app.get('/v1/account/sessions', async (request, reply) =>
    run(request, reply, async (client, _actor, currentSessionId) => {
      const result = await client.query<{
        id: string;
        created_at: Date;
        last_seen_at: Date;
      }>(
        `SELECT id, created_at, last_seen_at FROM account_sessions
         WHERE user_id = ayra.current_actor_id() AND revoked_at IS NULL
         ORDER BY created_at DESC`,
      );
      return {
        sessions: result.rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          lastSeenAt: row.last_seen_at,
          current: row.id === currentSessionId,
        })),
      };
    }),
  );

  app.post('/v1/account/sessions/revoke-others', async (request, reply) =>
    run(request, reply, async (client, _actor, currentSessionId) => {
      const result = await client.query<{ revoked: number }>(
        'SELECT ayra.revoke_other_sessions($1) AS revoked',
        [currentSessionId],
      );
      return { revoked: result.rows[0]?.revoked ?? 0 };
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/v1/account/sessions/:id/revoke',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) =>
      run(request, reply, async (client) => {
        const result = await client.query<{ revoked: boolean }>(
          'SELECT ayra.revoke_account_session($1) AS revoked',
          [request.params.id],
        );
        if (!result.rows[0]?.revoked) return reply.code(404).send({ error: 'session_not_found' });
        return { revoked: true };
      }),
  );

  app.get('/v1/workspaces', async (request, reply) =>
    run(request, reply, async (client) => {
      const result = await client.query<{ id: string; name: string; role: string }>(
        `SELECT w.id, w.name, m.role FROM workspaces w
         JOIN workspace_memberships m ON m.workspace_id = w.id
         WHERE m.user_id = ayra.current_actor_id() AND m.status = 'ACTIVE'
         ORDER BY w.created_at, w.id`,
      );
      return { workspaces: result.rows };
    }),
  );

  app.post<{ Body: { name: string } }>(
    '/v1/workspaces',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 160 } },
        },
      },
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: 'invalid_workspace_name' });
      const outcome = await run(request, reply, async (client, actor) => {
        if (!workspacePolicy.authorize({ actor, action: 'workspace:create' }).allowed)
          return reply.code(403).send({ error: 'forbidden' });
        const result = await client.query<{ id: string }>(
          'SELECT ayra.create_workspace($1) AS id',
          [name],
        );
        return { id: result.rows[0]?.id, name, role: 'OWNER' };
      });
      if (reply.sent) return reply;
      return reply.code(201).send(outcome);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/v1/workspaces/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) =>
      run(request, reply, async (client, actor) => {
        const workspaceId = request.params.id as WorkspaceId;
        const member = await client.query<{ role: 'OWNER' | 'MEMBER' }>(
          `SELECT role FROM workspace_memberships
           WHERE workspace_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
          [workspaceId, actor],
        );
        const role = member.rows[0]?.role;
        const decision = workspacePolicy.authorize({
          actor,
          action: 'workspace:read',
          workspaceId,
          membership: role ? { workspaceId, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return reply.code(404).send({ error: 'workspace_not_found' });
        const result = await client.query<{ id: string; name: string }>(
          'SELECT id, name FROM workspaces WHERE id = $1',
          [workspaceId],
        );
        const workspace = result.rows[0];
        if (!workspace) return reply.code(404).send({ error: 'workspace_not_found' });
        return { ...workspace, role };
      }),
  );
}
