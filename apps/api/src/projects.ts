import { workspacePolicy } from '@ayra/auth';
import type { ProjectId, UserId, WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import type { Services } from './request-context';
import { runAuthorized } from './request-context';

const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;
type ProjectRow = {
  id: ProjectId;
  workspace_id: WorkspaceId;
  name: string;
  description: string;
  version: string;
  archived_at: Date | null;
};

async function roleInWorkspace(client: PoolClient, actor: UserId, workspaceId: WorkspaceId) {
  const result = await client.query<{ role: 'OWNER' | 'MEMBER' }>(
    `SELECT role FROM workspace_memberships
     WHERE workspace_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
    [workspaceId, actor],
  );
  return result.rows[0]?.role;
}

function projectDto(row: ProjectRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    version: Number(row.version),
    archivedAt: row.archived_at,
  };
}

function denied(reply: FastifyReply, reason: string) {
  return reason === 'NO_MEMBERSHIP'
    ? reply.code(404).send({ error: 'project_not_found' })
    : reply.code(403).send({ error: 'forbidden' });
}

export function registerProjectRoutes(app: FastifyInstance, services: Services) {
  app.post<{ Body: { workspaceId: string; name: string; description?: string } }>(
    '/v1/projects',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workspaceId', 'name'],
          additionalProperties: false,
          properties: {
            workspaceId: { type: 'string', format: 'uuid' },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            description: { type: 'string', maxLength: 10000 },
          },
        },
      },
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      if (!name) return reply.code(400).send({ error: 'invalid_project_name' });
      const idempotencyKey = request.headers['idempotency-key'];
      if (
        typeof idempotencyKey !== 'string' ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      )
        return reply.code(400).send({ error: 'idempotency_key_required' });
      const workspaceId = request.body.workspaceId as WorkspaceId;
      const description = request.body.description ?? '';
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ workspaceId, name, description }))
        .digest('hex');
      const outcome = await runAuthorized(services, request, reply, async (client, actor) => {
        const role = await roleInWorkspace(client, actor, workspaceId);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'project:create',
          workspaceId,
          membership: role ? { workspaceId, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const reservation = await client.query<{ id: string }>(
          `INSERT INTO idempotency_records(workspace_id, scope, key, request_hash, expires_at)
           VALUES ($1, 'project:create', $2, $3, now() + interval '24 hours')
           ON CONFLICT (workspace_id, scope, key) DO NOTHING RETURNING id`,
          [workspaceId, idempotencyKey, requestHash],
        );
        if (!reservation.rows[0]) {
          const previous = await client.query<{ request_hash: string; result_ref: string | null }>(
            `SELECT request_hash, result_ref FROM idempotency_records
             WHERE workspace_id = $1 AND scope = 'project:create' AND key = $2 FOR UPDATE`,
            [workspaceId, idempotencyKey],
          );
          const record = previous.rows[0];
          if (!record) throw new Error('Idempotency reservation missing');
          if (record.request_hash !== requestHash)
            return reply.code(409).send({ error: 'idempotency_key_conflict' });
          if (!record.result_ref) throw new Error('Idempotency result missing');
          const existing = await client.query<ProjectRow>(
            `SELECT id, workspace_id, name, description, version, archived_at
             FROM projects WHERE id = $1`,
            [record.result_ref],
          );
          if (!existing.rows[0]) throw new Error('Idempotency Project missing');
          return projectDto(existing.rows[0]);
        }
        const result = await client.query<ProjectRow>(
          `INSERT INTO projects(workspace_id, name, description, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id, workspace_id, name, description, version, archived_at`,
          [workspaceId, name, description, actor],
        );
        const project = result.rows[0];
        if (!project) throw new Error('Project insert returned no row');
        await client.query('UPDATE idempotency_records SET result_ref = $1 WHERE id = $2', [
          project.id,
          reservation.rows[0].id,
        ]);
        return projectDto(project);
      });
      if (reply.sent) return reply;
      return reply.code(201).send(outcome);
    },
  );

  app.get<{ Querystring: { workspaceId: string } }>(
    '/v1/projects',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['workspaceId'],
          additionalProperties: false,
          properties: { workspaceId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) =>
      runAuthorized(services, request, reply, async (client, actor) => {
        const workspaceId = request.query.workspaceId as WorkspaceId;
        const role = await roleInWorkspace(client, actor, workspaceId);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'project:read',
          workspaceId,
          membership: role ? { workspaceId, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const result = await client.query<ProjectRow>(
          `SELECT id, workspace_id, name, description, version, archived_at
           FROM projects WHERE workspace_id = $1 AND archived_at IS NULL AND deleted_at IS NULL
           ORDER BY created_at DESC, id DESC`,
          [workspaceId],
        );
        return { projects: result.rows.map(projectDto) };
      }),
  );

  app.get<{ Params: { id: string } }>(
    '/v1/projects/:id',
    { schema: { params: uuidParam } },
    async (request, reply) =>
      runAuthorized(services, request, reply, async (client, actor) => {
        const result = await client.query<ProjectRow>(
          `SELECT id, workspace_id, name, description, version, archived_at
           FROM projects WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL`,
          [request.params.id],
        );
        const project = result.rows[0];
        if (!project) return reply.code(404).send({ error: 'project_not_found' });
        const role = await roleInWorkspace(client, actor, project.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'project:read',
          workspaceId: project.workspace_id,
          membership: role ? { workspaceId: project.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        return projectDto(project);
      }),
  );

  app.patch<{
    Params: { id: string };
    Body: { version: number; name?: string; description?: string };
  }>(
    '/v1/projects/:id',
    {
      schema: {
        params: uuidParam,
        body: {
          type: 'object',
          required: ['version'],
          additionalProperties: false,
          anyOf: [{ required: ['name'] }, { required: ['description'] }],
          properties: {
            version: { type: 'integer', minimum: 1 },
            name: { type: 'string', minLength: 1, maxLength: 160 },
            description: { type: 'string', maxLength: 10000 },
          },
        },
      },
    },
    async (request, reply) => {
      const name = request.body.name?.trim();
      if (name === '') return reply.code(400).send({ error: 'invalid_project_name' });
      return runAuthorized(services, request, reply, async (client, actor) => {
        const existing = await client.query<ProjectRow>(
          `SELECT id, workspace_id, name, description, version, archived_at
           FROM projects WHERE id = $1 AND archived_at IS NULL AND deleted_at IS NULL`,
          [request.params.id],
        );
        const project = existing.rows[0];
        if (!project) return reply.code(404).send({ error: 'project_not_found' });
        const role = await roleInWorkspace(client, actor, project.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'project:update',
          workspaceId: project.workspace_id,
          membership: role ? { workspaceId: project.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const updated = await client.query<ProjectRow>(
          `UPDATE projects SET name = COALESCE($2, name), description = COALESCE($3, description),
           version = version + 1, updated_by = $4
           WHERE id = $1 AND version = $5 AND archived_at IS NULL AND deleted_at IS NULL
           RETURNING id, workspace_id, name, description, version, archived_at`,
          [project.id, name ?? null, request.body.description ?? null, actor, request.body.version],
        );
        const row = updated.rows[0];
        if (!row) return reply.code(409).send({ error: 'version_conflict' });
        return projectDto(row);
      });
    },
  );
}
