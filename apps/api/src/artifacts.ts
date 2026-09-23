import { workspacePolicy } from '@ayra/auth';
import type { ArtifactId, TaskId, UserId, WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { roleInWorkspace } from './membership';
import { claimIdempotency, finishIdempotency } from './idempotency';
import type { Services } from './request-context';
import { runAuthorized } from './request-context';

type ArtifactRow = {
  id: ArtifactId;
  workspace_id: WorkspaceId;
  task_id: TaskId;
  run_id: string | null;
  title: string;
  version: string;
  deleted_at: Date | null;
};
const fields = 'id, workspace_id, task_id, run_id, title, version, deleted_at';
const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;
function dto(row: ArtifactRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    runId: row.run_id,
    title: row.title,
    version: Number(row.version),
    deletedAt: row.deleted_at,
  };
}
function denied(reply: FastifyReply, reason: string) {
  return reason === 'NO_MEMBERSHIP'
    ? reply.code(404).send({ error: 'artifact_not_found' })
    : reply.code(403).send({ error: 'forbidden' });
}

/** Internal metadata write. Caller supplies an authenticated transaction with actor GUC set. */
export async function createArtifactMetadata(
  client: PoolClient,
  actor: UserId,
  input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
    runId?: string | null;
    title: string;
    objectRef: string;
    provenance?: Record<string, unknown>;
    idempotencyKey: string;
  },
) {
  const title = input.title.trim();
  const objectRef = input.objectRef.trim();
  if (!title || title.length > 240 || !objectRef) throw new Error('Invalid Artifact metadata');
  const role = await roleInWorkspace(client, actor, input.workspaceId);
  const decision = workspacePolicy.authorize({
    actor,
    action: 'artifact:create',
    workspaceId: input.workspaceId,
    membership: role ? { workspaceId: input.workspaceId, role, status: 'ACTIVE' } : null,
  });
  if (!decision.allowed) throw new Error('Artifact write denied by Policy');
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128)
    throw new Error('Invalid Artifact idempotency key');
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        runId: input.runId ?? null,
        title,
        objectRef,
        provenance: input.provenance ?? {},
      }),
    )
    .digest('hex');
  const claim = await claimIdempotency(
    client,
    input.workspaceId,
    'artifact:create',
    input.idempotencyKey,
    hash,
  );
  if (claim.kind === 'conflict') throw new Error('Artifact idempotency key conflict');
  if (claim.kind === 'replay') {
    const existing = await client.query<ArtifactRow>(
      `SELECT ${fields} FROM artifacts WHERE id = $1`,
      [claim.resultRef],
    );
    if (!existing.rows[0]) throw new Error('Idempotency Artifact missing');
    return dto(existing.rows[0]);
  }
  const task = await client.query<{ id: string }>(
    `SELECT id FROM tasks WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR SHARE`,
    [input.taskId, input.workspaceId],
  );
  if (!task.rows[0]) throw new Error('Artifact Task is unavailable');
  const inserted = await client.query<ArtifactRow>(
    `INSERT INTO artifacts(workspace_id, task_id, run_id, title, object_ref, provenance, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING ${fields}`,
    [
      input.workspaceId,
      input.taskId,
      input.runId ?? null,
      title,
      objectRef,
      JSON.stringify(input.provenance ?? {}),
      actor,
    ],
  );
  const artifact = inserted.rows[0];
  if (!artifact) throw new Error('Artifact insert returned no row');
  await finishIdempotency(client, claim.recordId, artifact.id);
  return dto(artifact);
}

/** Internal lifecycle write; the caller owns the transaction and retry policy. */
export async function softDeleteArtifactMetadata(
  client: PoolClient,
  actor: UserId,
  artifactId: ArtifactId,
  version: number,
) {
  const existing = await client.query<ArtifactRow>(
    `SELECT ${fields} FROM artifacts WHERE id = $1 AND deleted_at IS NULL`,
    [artifactId],
  );
  const artifact = existing.rows[0];
  if (!artifact) throw new Error('Artifact is unavailable');
  const role = await roleInWorkspace(client, actor, artifact.workspace_id);
  const decision = workspacePolicy.authorize({
    actor,
    action: 'artifact:delete',
    workspaceId: artifact.workspace_id,
    membership: role ? { workspaceId: artifact.workspace_id, role, status: 'ACTIVE' } : null,
  });
  if (!decision.allowed) throw new Error('Artifact delete denied by Policy');
  const updated = await client.query<ArtifactRow>(
    `UPDATE artifacts SET deleted_at = now(), version = version + 1, updated_by = $2
     WHERE id = $1 AND version = $3 AND deleted_at IS NULL RETURNING ${fields}`,
    [artifactId, actor, version],
  );
  if (!updated.rows[0]) throw new Error('Artifact version conflict');
  return dto(updated.rows[0]);
}

export function registerArtifactRoutes(app: FastifyInstance, services: Services) {
  app.get<{ Params: { id: string } }>(
    '/v1/artifacts/:id',
    { schema: { params: uuidParam } },
    async (request, reply) =>
      runAuthorized(services, request, reply, async (client, actor) => {
        const result = await client.query<ArtifactRow>(
          `SELECT ${fields} FROM artifacts WHERE id = $1 AND deleted_at IS NULL`,
          [request.params.id],
        );
        const artifact = result.rows[0];
        if (!artifact) return reply.code(404).send({ error: 'artifact_not_found' });
        const role = await roleInWorkspace(client, actor, artifact.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'artifact:read',
          workspaceId: artifact.workspace_id,
          membership: role ? { workspaceId: artifact.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        return dto(artifact);
      }),
  );
}
