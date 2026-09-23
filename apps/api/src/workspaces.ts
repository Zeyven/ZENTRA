import type { IdentityProvider, VerifiedSession } from '@ayra/auth';
import { workspacePolicy } from '@ayra/auth';
import type { UserId, WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

interface Services {
  identity?: IdentityProvider;
  pool?: Pool;
}
class RevokedSessionError extends Error {}

async function withActor<T>(
  pool: Pool,
  session: VerifiedSession,
  work: (client: PoolClient, actor: UserId, currentSessionId: string) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resolved = await client.query<{ id: UserId }>(
      'SELECT ayra.resolve_external_identity($1, $2) AS id',
      [session.provider, session.externalSubject],
    );
    const actor = resolved.rows[0]?.id;
    if (!actor) throw new Error('AYRA identity resolution failed');
    await client.query("SELECT set_config('ayra.actor_user_id', $1, true)", [actor]);
    const sessionHash = createHash('sha256')
      .update(session.provider)
      .update('\0')
      .update(session.sessionId)
      .digest('hex');
    const registered = await client.query<{ id: string | null }>(
      'SELECT ayra.register_verified_session($1, $2) AS id',
      [session.provider, sessionHash],
    );
    const currentSessionId = registered.rows[0]?.id;
    if (!currentSessionId) throw new RevokedSessionError('AYRA session revoked');
    const result = await work(client, actor, currentSessionId);
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
    work: (client: PoolClient, actor: UserId, currentSessionId: string) => Promise<T>,
  ) {
    if (!services.identity || !services.pool)
      return reply.code(503).send({ error: 'identity_unavailable' });
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization ?? '');
    if (!match?.[1]) return reply.code(401).send({ error: 'authentication_required' });
    const session = await services.identity.verifySession(match[1]);
    if (!session) return reply.code(401).send({ error: 'invalid_session' });
    try {
      return await withActor(services.pool, session, work);
    } catch (error) {
      if (error instanceof RevokedSessionError)
        return reply.code(401).send({ error: 'session_revoked' });
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
