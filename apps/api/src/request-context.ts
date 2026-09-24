import type { IdentityProvider, VerifiedSession } from '@ayra/auth';
import type { UserId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { S3Client } from '@aws-sdk/client-s3';

export interface Services {
  identity?: IdentityProvider;
  pool?: Pool;
  taskExecutionEnabled?: boolean;
  approvalDecisionsEnabled?: boolean;
  artifactAccess?: { client: S3Client; bucket: string };
}

export type AuthorizedWork<T> = (
  client: PoolClient,
  actor: UserId,
  currentSessionId: string,
) => Promise<T>;

class RevokedSessionError extends Error {}
export class InactiveProjectError extends Error {}
export class TransactionalConflictError extends Error {}

async function withActor<T>(pool: Pool, session: VerifiedSession, work: AuthorizedWork<T>) {
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

/** Revalidates the bearer and database session for every long-lived stream poll. */
export async function runStreamAuthorized<T>(
  services: Services,
  authorization: string | undefined,
  work: AuthorizedWork<T>,
): Promise<{ ok: true; value: T } | { ok: false; status: 401 | 503 }> {
  if (!services.identity || !services.pool) return { ok: false, status: 503 };
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
  if (!match?.[1]) return { ok: false, status: 401 };
  const session = await services.identity.verifySession(match[1]);
  if (!session) return { ok: false, status: 401 };
  try {
    return { ok: true, value: await withActor(services.pool, session, work) };
  } catch (error) {
    return { ok: false, status: error instanceof RevokedSessionError ? 401 : 503 };
  }
}

export async function runAuthorized<T>(
  services: Services,
  request: FastifyRequest,
  reply: FastifyReply,
  work: AuthorizedWork<T>,
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
    if (error instanceof InactiveProjectError)
      return reply.code(404).send({ error: 'project_not_found' });
    if (error instanceof TransactionalConflictError)
      return reply.code(409).send({ error: 'version_or_state_conflict' });
    request.log.error({ err: error }, 'Account database operation failed');
    return reply.code(503).send({ error: 'service_unavailable' });
  }
}
