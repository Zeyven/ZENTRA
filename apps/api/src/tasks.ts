import { workspacePolicy } from '@ayra/auth';
import type { TaskId, TaskStatus, WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { claimIdempotency, finishIdempotency, readIdempotencyKey } from './idempotency';
import { roleInWorkspace } from './membership';
import { requireActiveProject } from './project-reference';
import type { Services } from './request-context';
import { runAuthorized } from './request-context';

const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;
type TaskRow = {
  id: TaskId;
  workspace_id: WorkspaceId;
  project_id: string | null;
  title: string;
  goal: string;
  type: string;
  status: TaskStatus;
  current_run_id: string | null;
  version: string;
  deleted_at: Date | null;
};
function taskDto(row: TaskRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    title: row.title,
    goal: row.goal,
    type: row.type,
    status: row.status,
    currentRunId: row.current_run_id,
    version: Number(row.version),
    deletedAt: row.deleted_at,
  };
}
function denied(reply: FastifyReply, reason: string) {
  return reason === 'NO_MEMBERSHIP'
    ? reply.code(404).send({ error: 'task_not_found' })
    : reply.code(403).send({ error: 'forbidden' });
}
const selectTask = `SELECT id, workspace_id, project_id, title, goal, type, status,
  current_run_id, version, deleted_at FROM tasks WHERE id = $1 AND deleted_at IS NULL`;

export function registerTaskRoutes(app: FastifyInstance, services: Services) {
  app.post<{
    Body: { workspaceId: string; projectId?: string; title: string; goal: string; type: string };
  }>(
    '/v1/tasks',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workspaceId', 'title', 'goal', 'type'],
          additionalProperties: false,
          properties: {
            workspaceId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 1, maxLength: 240 },
            goal: { type: 'string', minLength: 1, maxLength: 20000 },
            type: { type: 'string', minLength: 1, maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      const title = request.body.title.trim();
      const goal = request.body.goal.trim();
      const type = request.body.type.trim();
      if (!title || !goal || !type) return reply.code(400).send({ error: 'invalid_task' });
      const idempotencyKey = readIdempotencyKey(request.headers['idempotency-key']);
      if (!idempotencyKey) return reply.code(400).send({ error: 'idempotency_key_required' });
      const workspaceId = request.body.workspaceId as WorkspaceId;
      const projectId = request.body.projectId ?? null;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ workspaceId, projectId, title, goal, type }))
        .digest('hex');
      const outcome = await runAuthorized(services, request, reply, async (client, actor) => {
        const role = await roleInWorkspace(client, actor, workspaceId);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'task:create',
          workspaceId,
          membership: role ? { workspaceId, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const claim = await claimIdempotency(
          client,
          workspaceId,
          'task:create',
          idempotencyKey,
          requestHash,
        );
        if (claim.kind === 'conflict')
          return reply.code(409).send({ error: 'idempotency_key_conflict' });
        if (claim.kind === 'replay') {
          const previous = await client.query<TaskRow>(
            `SELECT id, workspace_id, project_id, title, goal, type, status,
              current_run_id, version, deleted_at FROM tasks WHERE id = $1`,
            [claim.resultRef],
          );
          if (!previous.rows[0]) throw new Error('Idempotency Task missing');
          return taskDto(previous.rows[0]);
        }
        await requireActiveProject(client, workspaceId, projectId);
        const inserted = await client.query<TaskRow>(
          `INSERT INTO tasks(workspace_id, project_id, title, goal, type, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, workspace_id, project_id, title, goal, type, status, current_run_id, version, deleted_at`,
          [workspaceId, projectId, title, goal, type, actor],
        );
        const task = inserted.rows[0];
        if (!task) throw new Error('Task insert returned no row');
        await finishIdempotency(client, claim.recordId, task.id);
        return taskDto(task);
      });
      if (reply.sent) return reply;
      return reply.code(201).send(outcome);
    },
  );

  app.get<{ Querystring: { workspaceId: string; projectId?: string } }>(
    '/v1/tasks',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['workspaceId'],
          additionalProperties: false,
          properties: {
            workspaceId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) =>
      runAuthorized(services, request, reply, async (client, actor) => {
        const workspaceId = request.query.workspaceId as WorkspaceId;
        const role = await roleInWorkspace(client, actor, workspaceId);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'task:read',
          workspaceId,
          membership: role ? { workspaceId, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const result = await client.query<TaskRow>(
          `SELECT id, workspace_id, project_id, title, goal, type, status,
             current_run_id, version, deleted_at FROM tasks
           WHERE workspace_id = $1 AND deleted_at IS NULL
             AND ($2::uuid IS NULL OR project_id = $2::uuid)
           ORDER BY created_at DESC, id DESC`,
          [workspaceId, request.query.projectId ?? null],
        );
        return { tasks: result.rows.map(taskDto) };
      }),
  );

  app.get<{ Params: { id: string } }>(
    '/v1/tasks/:id',
    { schema: { params: uuidParam } },
    async (request, reply) =>
      runAuthorized(services, request, reply, async (client, actor) => {
        const result = await client.query<TaskRow>(selectTask, [request.params.id]);
        const task = result.rows[0];
        if (!task) return reply.code(404).send({ error: 'task_not_found' });
        const role = await roleInWorkspace(client, actor, task.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'task:read',
          workspaceId: task.workspace_id,
          membership: role ? { workspaceId: task.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        return taskDto(task);
      }),
  );

  app.patch<{ Params: { id: string }; Body: { version: number; title?: string; goal?: string } }>(
    '/v1/tasks/:id',
    {
      schema: {
        params: uuidParam,
        body: {
          type: 'object',
          required: ['version'],
          additionalProperties: false,
          anyOf: [{ required: ['title'] }, { required: ['goal'] }],
          properties: {
            version: { type: 'integer', minimum: 1 },
            title: { type: 'string', minLength: 1, maxLength: 240 },
            goal: { type: 'string', minLength: 1, maxLength: 20000 },
          },
        },
      },
    },
    async (request, reply) => {
      const title = request.body.title?.trim();
      const goal = request.body.goal?.trim();
      if (title === '' || goal === '') return reply.code(400).send({ error: 'invalid_task' });
      return runAuthorized(services, request, reply, async (client, actor) => {
        const existing = await client.query<TaskRow>(selectTask, [request.params.id]);
        const task = existing.rows[0];
        if (!task) return reply.code(404).send({ error: 'task_not_found' });
        const role = await roleInWorkspace(client, actor, task.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'task:update',
          workspaceId: task.workspace_id,
          membership: role ? { workspaceId: task.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const result = await client.query<TaskRow>(
          `UPDATE tasks SET title = COALESCE($2, title), goal = COALESCE($3, goal),
             version = version + 1, updated_by = $4
           WHERE id = $1 AND version = $5 AND status = 'DRAFT' AND deleted_at IS NULL
           RETURNING id, workspace_id, project_id, title, goal, type, status, current_run_id, version, deleted_at`,
          [task.id, title ?? null, goal ?? null, actor, request.body.version],
        );
        if (!result.rows[0]) return reply.code(409).send({ error: 'version_or_state_conflict' });
        return taskDto(result.rows[0]);
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/v1/tasks/:id/delete',
    {
      schema: {
        params: uuidParam,
        body: {
          type: 'object',
          required: ['version'],
          additionalProperties: false,
          properties: { version: { type: 'integer', minimum: 1 } },
        },
      },
    },
    async (request, reply) =>
      runAuthorized(services, request, reply, async (client, actor) => {
        const existing = await client.query<TaskRow>(selectTask, [request.params.id]);
        const task = existing.rows[0];
        if (!task) return reply.code(404).send({ error: 'task_not_found' });
        const role = await roleInWorkspace(client, actor, task.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'task:delete',
          workspaceId: task.workspace_id,
          membership: role ? { workspaceId: task.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const result = await client.query<{ id: string; version: string }>(
          `UPDATE tasks SET deleted_at = now(), version = version + 1, updated_by = $2
           WHERE id = $1 AND version = $3 AND status = 'DRAFT' AND deleted_at IS NULL
           RETURNING id, version`,
          [task.id, actor, request.body.version],
        );
        if (!result.rows[0]) return reply.code(409).send({ error: 'version_or_state_conflict' });
        return { id: result.rows[0].id, version: Number(result.rows[0].version), deleted: true };
      }),
  );
}
