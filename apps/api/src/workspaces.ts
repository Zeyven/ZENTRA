import type { IdentityProvider } from '@ayra/auth';
import { workspacePolicy } from '@ayra/auth';
import type { UserId, WorkspaceId } from '@ayra/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

interface Services {
  identity?: IdentityProvider;
  pool?: Pool;
}

async function withActor<T>(
  pool: Pool,
  provider: string,
  subject: string,
  work: (client: PoolClient, actor: UserId) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resolved = await client.query<{ id: UserId }>(
      'SELECT ayra.resolve_external_identity($1, $2) AS id',
      [provider, subject],
    );
    const actor = resolved.rows[0]?.id;
    if (!actor) throw new Error('AYRA identity resolution failed');
    await client.query("SELECT set_config('ayra.actor_user_id', $1, true)", [actor]);
    const result = await work(client, actor);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function registerWorkspaceRoutes(app: FastifyInstance, services: Services) {
  async function run<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    work: (client: PoolClient, actor: UserId) => Promise<T>,
  ) {
    if (!services.identity || !services.pool)
      return reply.code(503).send({ error: 'identity_unavailable' });
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '');
    if (!match?.[1]) return reply.code(401).send({ error: 'authentication_required' });
    const session = await services.identity.verifySession(match[1]);
    if (!session) return reply.code(401).send({ error: 'invalid_session' });
    try {
      return await withActor(services.pool, session.provider, session.externalSubject, work);
    } catch (error) {
      request.log.error({ err: error }, 'Account database operation failed');
      return reply.code(503).send({ error: 'service_unavailable' });
    }
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
