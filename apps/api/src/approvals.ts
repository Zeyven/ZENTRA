import { workspacePolicy } from '@ayra/auth';
import type { ApprovalId, RunId, TaskId, UserId, WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { claimIdempotency, finishIdempotency } from './idempotency';
import { roleInWorkspace } from './membership';
import type { Services } from './request-context';
import { runAuthorized } from './request-context';

type ApprovalRow = {
  id: ApprovalId;
  workspace_id: WorkspaceId;
  user_id: UserId;
  task_id: TaskId;
  run_id: RunId;
  action: string;
  resource_ref: string;
  arguments_hash: string;
  state_version: string;
  expires_at: Date;
  status: string;
  version: string;
};
const fields =
  'id, workspace_id, user_id, task_id, run_id, action, resource_ref, arguments_hash, state_version, expires_at, status, version';
function dto(row: ApprovalRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    taskId: row.task_id,
    runId: row.run_id,
    action: row.action,
    resourceRef: row.resource_ref,
    argumentsHash: row.arguments_hash,
    stateVersion: Number(row.state_version),
    expiresAt: row.expires_at,
    status: row.status,
    version: Number(row.version),
  };
}

/** Creates a pending, parameter-bound request; it cannot approve or execute the action. */
export async function createApprovalRequest(
  client: PoolClient,
  actor: UserId,
  input: {
    workspaceId: WorkspaceId;
    userId: UserId;
    taskId: TaskId;
    runId: RunId;
    action: string;
    resourceRef: string;
    argumentsHash: string;
    stateVersion: number;
    expiresAt: Date;
    idempotencyKey: string;
  },
) {
  const action = input.action.trim();
  const resourceRef = input.resourceRef.trim();
  if (!action || action.length > 120 || !resourceRef || resourceRef.length > 2048)
    throw new Error('Invalid Approval action or resource');
  if (!/^[0-9a-f]{64}$/.test(input.argumentsHash))
    throw new Error('Invalid Approval arguments hash');
  if (!Number.isSafeInteger(input.stateVersion) || input.stateVersion < 1)
    throw new Error('Invalid Approval state version');
  if (!(input.expiresAt instanceof Date) || input.expiresAt.getTime() <= Date.now())
    throw new Error('Approval expiry must be in the future');
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 128)
    throw new Error('Invalid Approval idempotency key');
  const role = await roleInWorkspace(client, actor, input.workspaceId);
  const decision = workspacePolicy.authorize({
    actor,
    action: 'approval:create',
    workspaceId: input.workspaceId,
    membership: role ? { workspaceId: input.workspaceId, role, status: 'ACTIVE' } : null,
  });
  if (!decision.allowed) throw new Error('Approval write denied by Policy');
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        userId: input.userId,
        taskId: input.taskId,
        runId: input.runId,
        action,
        resourceRef,
        argumentsHash: input.argumentsHash,
        stateVersion: input.stateVersion,
        expiresAt: input.expiresAt.toISOString(),
      }),
    )
    .digest('hex');
  const claim = await claimIdempotency(
    client,
    input.workspaceId,
    'approval:request',
    input.idempotencyKey,
    hash,
  );
  if (claim.kind === 'conflict') throw new Error('Approval idempotency key conflict');
  if (claim.kind === 'replay') {
    const previous = await client.query<ApprovalRow>(
      `SELECT ${fields} FROM approvals WHERE id = $1`,
      [claim.resultRef],
    );
    if (!previous.rows[0]) throw new Error('Idempotency Approval missing');
    return dto(previous.rows[0]);
  }
  const target = await client.query<{ id: string }>(
    `SELECT id FROM workspace_memberships
     WHERE workspace_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
    [input.workspaceId, input.userId],
  );
  if (!target.rows[0]) throw new Error('Approval target is not an active member');
  const run = await client.query<{ id: string }>(
    `SELECT r.id FROM runs r JOIN tasks t
       ON t.workspace_id = r.workspace_id AND t.id = r.task_id
     WHERE r.id = $1 AND r.workspace_id = $2 AND r.task_id = $3
       AND t.deleted_at IS NULL FOR SHARE OF r, t`,
    [input.runId, input.workspaceId, input.taskId],
  );
  if (!run.rows[0]) throw new Error('Approval Run is unavailable');
  const inserted = await client.query<ApprovalRow>(
    `INSERT INTO approvals(
       workspace_id, user_id, task_id, run_id, action, resource_ref,
       arguments_hash, state_version, expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${fields}`,
    [
      input.workspaceId,
      input.userId,
      input.taskId,
      input.runId,
      action,
      resourceRef,
      input.argumentsHash,
      input.stateVersion,
      input.expiresAt,
    ],
  );
  const approval = inserted.rows[0];
  if (!approval) throw new Error('Approval insert returned no row');
  await finishIdempotency(client, claim.recordId, approval.id);
  return dto(approval);
}

export async function readApprovalRequest(
  client: PoolClient,
  actor: UserId,
  approvalId: ApprovalId,
) {
  const result = await client.query<ApprovalRow>(`SELECT ${fields} FROM approvals WHERE id = $1`, [
    approvalId,
  ]);
  const approval = result.rows[0];
  if (!approval) return null;
  const role = await roleInWorkspace(client, actor, approval.workspace_id);
  const decision = workspacePolicy.authorize({
    actor,
    action: 'approval:read',
    workspaceId: approval.workspace_id,
    membership: role ? { workspaceId: approval.workspace_id, role, status: 'ACTIVE' } : null,
  });
  return decision.allowed ? dto(approval) : null;
}

const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export function registerApprovalRoutes(app: FastifyInstance, services: Services) {
  app.get<{ Params: { id: string } }>(
    '/v1/approvals/:id',
    { schema: { params: uuidParam } },
    async (request, reply) => {
      const result = await runAuthorized(services, request, reply, (client, actor) =>
        readApprovalRequest(client, actor, request.params.id as ApprovalId),
      );
      if (reply.sent) return reply;
      return result ?? reply.code(404).send({ error: 'approval_not_found' });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { version: number; decision: 'APPROVED' | 'REJECTED' };
  }>(
    '/v1/approvals/:id/decision',
    {
      schema: {
        params: uuidParam,
        body: {
          type: 'object',
          required: ['version', 'decision'],
          additionalProperties: false,
          properties: {
            version: { type: 'integer', minimum: 1 },
            decision: { type: 'string', enum: ['APPROVED', 'REJECTED'] },
          },
        },
      },
    },
    async (request, reply) => {
      if (!services.approvalDecisionsEnabled)
        return reply.code(503).send({ error: 'approval_decisions_unavailable' });
      const outcome = await runAuthorized(services, request, reply, async (client, actor) => {
        const approval = await readApprovalRequest(client, actor, request.params.id as ApprovalId);
        if (!approval || approval.userId !== actor)
          return reply.code(404).send({ error: 'approval_not_found' });
        const role = await roleInWorkspace(client, actor, approval.workspaceId);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'approval:decide',
          workspaceId: approval.workspaceId,
          membership: role ? { workspaceId: approval.workspaceId, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return reply.code(404).send({ error: 'approval_not_found' });
        const result = await client.query<{ outcome: string }>(
          'SELECT ayra.decide_approval($1, $2, $3) AS outcome',
          [request.params.id, request.body.version, request.body.decision],
        );
        const status = result.rows[0]?.outcome;
        if (status === 'NOT_FOUND') return reply.code(404).send({ error: 'approval_not_found' });
        if (status === 'CONFLICT')
          return reply.code(409).send({ error: 'version_or_state_conflict' });
        if (status === 'STALE' || status === 'EXPIRED')
          return reply.code(409).send({ error: 'approval_invalid', reason: status });
        if (status !== 'APPROVED' && status !== 'REJECTED')
          throw new Error('Unknown Approval decision outcome');
        return { id: request.params.id, status, version: request.body.version + 1 };
      });
      return reply.sent ? reply : outcome;
    },
  );
}
