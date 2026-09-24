import { workspacePolicy } from '@ayra/auth';
import type { TaskId, TaskStatus, WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { claimIdempotency, finishIdempotency, readIdempotencyKey } from './idempotency';
import { roleInWorkspace } from './membership';
import { requireActiveProject } from './project-reference';
import type { Services } from './request-context';
import { runAuthorized, TransactionalConflictError } from './request-context';

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
  failure_code: string | null;
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
    failureCode: row.failure_code,
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
  failure_code, current_run_id, version, deleted_at FROM tasks WHERE id = $1 AND deleted_at IS NULL`;

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
              failure_code, current_run_id, version, deleted_at FROM tasks WHERE id = $1`,
            [claim.resultRef],
          );
          if (!previous.rows[0]) throw new Error('Idempotency Task missing');
          return taskDto(previous.rows[0]);
        }
        await requireActiveProject(client, workspaceId, projectId);
        const inserted = await client.query<TaskRow>(
          `INSERT INTO tasks(workspace_id, project_id, title, goal, type, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, workspace_id, project_id, title, goal, type, status, failure_code, current_run_id, version, deleted_at`,
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

  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/v1/tasks/:id/start',
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
    async (request, reply) => {
      if (!services.taskExecutionEnabled)
        return reply.code(503).send({ error: 'task_execution_unavailable' });
      const idempotencyKey = readIdempotencyKey(request.headers['idempotency-key']);
      if (!idempotencyKey) return reply.code(400).send({ error: 'idempotency_key_required' });
      const taskId = request.params.id;
      const expectedVersion = request.body.version;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ taskId, expectedVersion }))
        .digest('hex');
      const outcome = await runAuthorized(services, request, reply, async (client, actor) => {
        const existing = await client.query<TaskRow>(selectTask, [taskId]);
        const task = existing.rows[0];
        if (!task) return reply.code(404).send({ error: 'task_not_found' });
        const role = await roleInWorkspace(client, actor, task.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'task:start',
          workspaceId: task.workspace_id,
          membership: role ? { workspaceId: task.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const claim = await claimIdempotency(
          client,
          task.workspace_id,
          'task:start',
          idempotencyKey,
          requestHash,
        );
        if (claim.kind === 'conflict')
          return reply.code(409).send({ error: 'idempotency_key_conflict' });
        if (claim.kind === 'replay') {
          const previous = await client.query<{ id: string }>(
            'SELECT id FROM runs WHERE id = $1 AND task_id = $2 AND workspace_id = $3',
            [claim.resultRef, task.id, task.workspace_id],
          );
          if (!previous.rows[0]) throw new Error('Idempotency Run missing');
          return {
            taskId: task.id,
            runId: previous.rows[0].id,
            status: task.status,
            version: Number(task.version),
          };
        }
        const started = await client.query<{
          result_code: string;
          run_id: string | null;
          task_version: string | null;
        }>('SELECT * FROM ayra.start_task_attempt($1, $2)', [task.id, expectedVersion]);
        const result = started.rows[0];
        if (result?.result_code !== 'STARTED' || !result.run_id || !result.task_version)
          throw new TransactionalConflictError('Task is no longer a Draft at the expected version');
        await finishIdempotency(client, claim.recordId, result.run_id);
        return {
          taskId: task.id,
          runId: result.run_id,
          status: 'QUEUED',
          version: Number(result.task_version),
        };
      });
      if (reply.sent) return reply;
      return reply.code(202).send(outcome);
    },
  );

  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/v1/tasks/:id/cancel',
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
    async (request, reply) => {
      if (!services.taskExecutionEnabled)
        return reply.code(503).send({ error: 'task_execution_unavailable' });
      const idempotencyKey = readIdempotencyKey(request.headers['idempotency-key']);
      if (!idempotencyKey) return reply.code(400).send({ error: 'idempotency_key_required' });
      const taskId = request.params.id;
      const expectedVersion = request.body.version;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ taskId, expectedVersion }))
        .digest('hex');
      const outcome = await runAuthorized(services, request, reply, async (client, actor) => {
        const existing = await client.query<TaskRow>(selectTask, [taskId]);
        const task = existing.rows[0];
        if (!task) return reply.code(404).send({ error: 'task_not_found' });
        const role = await roleInWorkspace(client, actor, task.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'task:cancel',
          workspaceId: task.workspace_id,
          membership: role ? { workspaceId: task.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const claim = await claimIdempotency(
          client,
          task.workspace_id,
          'task:cancel',
          idempotencyKey,
          requestHash,
        );
        if (claim.kind === 'conflict')
          return reply.code(409).send({ error: 'idempotency_key_conflict' });
        if (claim.kind === 'replay') {
          if (claim.resultRef !== task.id) throw new Error('Idempotency Task mismatch');
          return {
            taskId: task.id,
            runId: task.current_run_id,
            status: task.status,
            version: Number(task.version),
          };
        }
        const canceled = await client.query<{
          result_code: string;
          run_id: string | null;
          task_version: string | null;
        }>('SELECT * FROM ayra.cancel_task_attempt($1, $2)', [task.id, expectedVersion]);
        const result = canceled.rows[0];
        if (result?.result_code !== 'CANCELED' || !result.task_version)
          throw new TransactionalConflictError('Task cannot be canceled at the expected version');
        await finishIdempotency(client, claim.recordId, task.id);
        return {
          taskId: task.id,
          runId: result.run_id,
          status: 'CANCELED',
          version: Number(result.task_version),
        };
      });
      if (reply.sent) return reply;
      return reply.code(200).send(outcome);
    },
  );

  for (const operation of ['pause', 'resume'] as const) {
    app.post<{ Params: { id: string }; Body: { version: number } }>(
      `/v1/tasks/:id/${operation}`,
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
      async (request, reply) => {
        if (!services.taskExecutionEnabled)
          return reply.code(503).send({ error: 'task_execution_unavailable' });
        const idempotencyKey = readIdempotencyKey(request.headers['idempotency-key']);
        if (!idempotencyKey) return reply.code(400).send({ error: 'idempotency_key_required' });
        const taskId = request.params.id;
        const expectedVersion = request.body.version;
        const requestHash = createHash('sha256')
          .update(JSON.stringify({ taskId, expectedVersion }))
          .digest('hex');
        const outcome = await runAuthorized(services, request, reply, async (client, actor) => {
          const existing = await client.query<TaskRow>(selectTask, [taskId]);
          const task = existing.rows[0];
          if (!task) return reply.code(404).send({ error: 'task_not_found' });
          const role = await roleInWorkspace(client, actor, task.workspace_id);
          const decision = workspacePolicy.authorize({
            actor,
            action: operation === 'pause' ? 'task:pause' : 'task:resume',
            workspaceId: task.workspace_id,
            membership: role ? { workspaceId: task.workspace_id, role, status: 'ACTIVE' } : null,
          });
          if (!decision.allowed) return denied(reply, decision.reason);
          const claim = await claimIdempotency(
            client,
            task.workspace_id,
            `task:${operation}`,
            idempotencyKey,
            requestHash,
          );
          if (claim.kind === 'conflict')
            return reply.code(409).send({ error: 'idempotency_key_conflict' });
          if (claim.kind === 'replay') {
            if (claim.resultRef !== task.id) throw new Error('Idempotency Task mismatch');
            return {
              taskId: task.id,
              runId: task.current_run_id,
              status: task.status,
              version: Number(task.version),
            };
          }
          const functionName = operation === 'pause' ? 'pause_task_attempt' : 'resume_task_attempt';
          const changed = await client.query<{
            result_code: string;
            run_id: string | null;
            task_version: string | null;
          }>(`SELECT * FROM ayra.${functionName}($1, $2)`, [task.id, expectedVersion]);
          const result = changed.rows[0];
          if (
            result?.result_code !== (operation === 'pause' ? 'PAUSED' : 'RESUMED') ||
            !result.run_id
          )
            throw new TransactionalConflictError(
              'Task cannot change control state at the expected version',
            );
          await finishIdempotency(client, claim.recordId, task.id);
          const current = await client.query<TaskRow>(selectTask, [task.id]);
          if (!current.rows[0]) throw new Error('Controlled Task disappeared');
          return {
            taskId: task.id,
            runId: result.run_id,
            status: current.rows[0].status,
            version: Number(current.rows[0].version),
          };
        });
        if (reply.sent) return reply;
        return reply.code(200).send(outcome);
      },
    );
  }

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
             failure_code, current_run_id, version, deleted_at FROM tasks
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

  app.get<{
    Params: { id: string };
    Querystring: { afterVersion?: number; limit?: number };
  }>(
    '/v1/tasks/:id/events',
    {
      schema: {
        params: uuidParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            afterVersion: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
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
        const events = await client.query<{
          id: string;
          event_type: string;
          event_version: string;
          payload: Record<string, unknown>;
          created_at: Date;
        }>(
          `SELECT id, event_type, event_version, payload, created_at
             FROM ayra.read_task_events($1, $2, $3)`,
          [request.params.id, request.query.afterVersion ?? 0, request.query.limit ?? 50],
        );
        const items = events.rows.map((event) => ({
          id: event.id,
          type: event.event_type,
          version: Number(event.event_version),
          payload: event.payload,
          createdAt: event.created_at,
        }));
        return {
          taskId: task.id,
          events: items,
          nextAfterVersion: items.at(-1)?.version ?? request.query.afterVersion ?? 0,
        };
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
           RETURNING id, workspace_id, project_id, title, goal, type, status, failure_code, current_run_id, version, deleted_at`,
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
