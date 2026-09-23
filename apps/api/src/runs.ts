import { workspacePolicy } from '@ayra/auth';
import type { RunId, TaskId, UserId, WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { claimIdempotency, finishIdempotency } from './idempotency';
import { roleInWorkspace } from './membership';

type RunRow = {
  id: RunId;
  workspace_id: WorkspaceId;
  task_id: TaskId;
  attempt: string;
  status: string;
  version: string;
};
const fields = 'id, workspace_id, task_id, attempt, status, version';
function dto(row: RunRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    attempt: Number(row.attempt),
    status: row.status,
    version: Number(row.version),
  };
}

/** Records an attempt only. Temporal dispatch and Task state transitions belong to M3. */
export async function createRunAttempt(
  client: PoolClient,
  actor: UserId,
  input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
    attempt: number;
    idempotencyKey: string;
  },
) {
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1)
    throw new Error('Invalid Run attempt number');
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128)
    throw new Error('Invalid Run idempotency key');
  const role = await roleInWorkspace(client, actor, input.workspaceId);
  const decision = workspacePolicy.authorize({
    actor,
    action: 'run:create',
    workspaceId: input.workspaceId,
    membership: role ? { workspaceId: input.workspaceId, role, status: 'ACTIVE' } : null,
  });
  if (!decision.allowed) throw new Error('Run write denied by Policy');
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        attempt: input.attempt,
      }),
    )
    .digest('hex');
  const claim = await claimIdempotency(
    client,
    input.workspaceId,
    'run:create',
    input.idempotencyKey,
    hash,
  );
  if (claim.kind === 'conflict') throw new Error('Run idempotency key conflict');
  if (claim.kind === 'replay') {
    const previous = await client.query<RunRow>(`SELECT ${fields} FROM runs WHERE id = $1`, [
      claim.resultRef,
    ]);
    if (!previous.rows[0]) throw new Error('Idempotency Run missing');
    return dto(previous.rows[0]);
  }
  const task = await client.query<{ id: string }>(
    `SELECT id FROM tasks WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR SHARE`,
    [input.taskId, input.workspaceId],
  );
  if (!task.rows[0]) throw new Error('Run Task is unavailable');
  const inserted = await client.query<RunRow>(
    `INSERT INTO runs(workspace_id, task_id, attempt, status, created_by)
     VALUES ($1, $2, $3, 'PENDING', $4) RETURNING ${fields}`,
    [input.workspaceId, input.taskId, input.attempt, actor],
  );
  const run = inserted.rows[0];
  if (!run) throw new Error('Run insert returned no row');
  await finishIdempotency(client, claim.recordId, run.id);
  return dto(run);
}

export async function readRunAttempt(client: PoolClient, actor: UserId, runId: RunId) {
  const result = await client.query<RunRow>(`SELECT ${fields} FROM runs WHERE id = $1`, [runId]);
  const run = result.rows[0];
  if (!run) return null;
  const role = await roleInWorkspace(client, actor, run.workspace_id);
  const decision = workspacePolicy.authorize({
    actor,
    action: 'run:read',
    workspaceId: run.workspace_id,
    membership: role ? { workspaceId: run.workspace_id, role, status: 'ACTIVE' } : null,
  });
  return decision.allowed ? dto(run) : null;
}
