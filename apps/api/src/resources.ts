import { workspacePolicy } from '@ayra/auth';
import type { WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { claimIdempotency, finishIdempotency, readIdempotencyKey } from './idempotency';
import { roleInWorkspace } from './membership';
import type { Services } from './request-context';
import { runAuthorized } from './request-context';

type ResourceRow = {
  id: string;
  workspace_id: WorkspaceId;
  project_id: string | null;
  title: string;
  source_ref: string;
  version: string;
  deleted_at: Date | null;
};
const fields = 'id, workspace_id, project_id, title, source_ref, version, deleted_at';
const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;
function dto(row: ResourceRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    title: row.title,
    sourceRef: row.source_ref,
    version: Number(row.version),
    deletedAt: row.deleted_at,
  };
}
function denied(reply: FastifyReply, reason: string) {
  return reason === 'NO_MEMBERSHIP'
    ? reply.code(404).send({ error: 'resource_not_found' })
    : reply.code(403).send({ error: 'forbidden' });
}

export function registerResourceRoutes(app: FastifyInstance, services: Services) {
  app.post<{
    Body: { workspaceId: string; projectId?: string; title: string; sourceRef: string };
  }>(
    '/v1/resources',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workspaceId', 'title', 'sourceRef'],
          additionalProperties: false,
          properties: {
            workspaceId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 1, maxLength: 240 },
            sourceRef: { type: 'string', minLength: 1, maxLength: 2048 },
          },
        },
      },
    },
    async (request, reply) => {
      const title = request.body.title.trim();
      const sourceRef = request.body.sourceRef.trim();
      if (!title || !sourceRef) return reply.code(400).send({ error: 'invalid_resource' });
      const key = readIdempotencyKey(request.headers['idempotency-key']);
      if (!key) return reply.code(400).send({ error: 'idempotency_key_required' });
      const workspaceId = request.body.workspaceId as WorkspaceId;
      const projectId = request.body.projectId ?? null;
      const hash = createHash('sha256')
        .update(JSON.stringify({ workspaceId, projectId, title, sourceRef }))
        .digest('hex');
      const outcome = await runAuthorized(services, request, reply, async (client, actor) => {
        const role = await roleInWorkspace(client, actor, workspaceId);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'resource:create',
          workspaceId,
          membership: role ? { workspaceId, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        if (projectId) {
          const project = await client.query(
            `SELECT id FROM projects WHERE id = $1 AND workspace_id = $2
             AND archived_at IS NULL AND deleted_at IS NULL`,
            [projectId, workspaceId],
          );
          if (!project.rows[0]) return reply.code(404).send({ error: 'project_not_found' });
        }
        const claim = await claimIdempotency(client, workspaceId, 'resource:create', key, hash);
        if (claim.kind === 'conflict')
          return reply.code(409).send({ error: 'idempotency_key_conflict' });
        if (claim.kind === 'replay') {
          const previous = await client.query<ResourceRow>(
            `SELECT ${fields} FROM resources WHERE id = $1`,
            [claim.resultRef],
          );
          if (!previous.rows[0]) throw new Error('Idempotency Resource missing');
          return dto(previous.rows[0]);
        }
        const inserted = await client.query<ResourceRow>(
          `INSERT INTO resources(workspace_id, project_id, title, source_ref, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING ${fields}`,
          [workspaceId, projectId, title, sourceRef, actor],
        );
        const resource = inserted.rows[0];
        if (!resource) throw new Error('Resource insert returned no row');
        await finishIdempotency(client, claim.recordId, resource.id);
        return dto(resource);
      });
      if (reply.sent) return reply;
      return reply.code(201).send(outcome);
    },
  );

  app.get<{ Querystring: { workspaceId: string; projectId?: string } }>(
    '/v1/resources',
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
          action: 'resource:read',
          workspaceId,
          membership: role ? { workspaceId, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const result = await client.query<ResourceRow>(
          `SELECT ${fields} FROM resources
           WHERE workspace_id = $1 AND deleted_at IS NULL
             AND ($2::uuid IS NULL OR project_id = $2)
           ORDER BY created_at DESC, id DESC`,
          [workspaceId, request.query.projectId ?? null],
        );
        return { resources: result.rows.map(dto) };
      }),
  );

  app.get<{ Params: { id: string } }>(
    '/v1/resources/:id',
    { schema: { params: uuidParam } },
    async (request, reply) =>
      runAuthorized(services, request, reply, async (client, actor) => {
        const result = await client.query<ResourceRow>(
          `SELECT ${fields} FROM resources WHERE id = $1 AND deleted_at IS NULL`,
          [request.params.id],
        );
        const resource = result.rows[0];
        if (!resource) return reply.code(404).send({ error: 'resource_not_found' });
        const role = await roleInWorkspace(client, actor, resource.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'resource:read',
          workspaceId: resource.workspace_id,
          membership: role ? { workspaceId: resource.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        return dto(resource);
      }),
  );

  app.patch<{ Params: { id: string }; Body: { version: number; title: string } }>(
    '/v1/resources/:id',
    {
      schema: {
        params: uuidParam,
        body: {
          type: 'object',
          required: ['version', 'title'],
          additionalProperties: false,
          properties: {
            version: { type: 'integer', minimum: 1 },
            title: { type: 'string', minLength: 1, maxLength: 240 },
          },
        },
      },
    },
    async (request, reply) => {
      const title = request.body.title.trim();
      if (!title) return reply.code(400).send({ error: 'invalid_resource_title' });
      return runAuthorized(services, request, reply, async (client, actor) => {
        const result = await client.query<ResourceRow>(
          `SELECT ${fields} FROM resources WHERE id = $1 AND deleted_at IS NULL`,
          [request.params.id],
        );
        const resource = result.rows[0];
        if (!resource) return reply.code(404).send({ error: 'resource_not_found' });
        const role = await roleInWorkspace(client, actor, resource.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'resource:update',
          workspaceId: resource.workspace_id,
          membership: role ? { workspaceId: resource.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const updated = await client.query<ResourceRow>(
          `UPDATE resources SET title = $2, version = version + 1, updated_by = $3
           WHERE id = $1 AND version = $4 AND deleted_at IS NULL RETURNING ${fields}`,
          [resource.id, title, actor, request.body.version],
        );
        if (!updated.rows[0]) return reply.code(409).send({ error: 'version_conflict' });
        return dto(updated.rows[0]);
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { version: number } }>(
    '/v1/resources/:id/delete',
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
        const result = await client.query<ResourceRow>(
          `SELECT ${fields} FROM resources WHERE id = $1 AND deleted_at IS NULL`,
          [request.params.id],
        );
        const resource = result.rows[0];
        if (!resource) return reply.code(404).send({ error: 'resource_not_found' });
        const role = await roleInWorkspace(client, actor, resource.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'resource:delete',
          workspaceId: resource.workspace_id,
          membership: role ? { workspaceId: resource.workspace_id, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const deleted = await client.query<ResourceRow>(
          `UPDATE resources SET deleted_at = now(), version = version + 1, updated_by = $2
           WHERE id = $1 AND version = $3 AND deleted_at IS NULL RETURNING ${fields}`,
          [resource.id, actor, request.body.version],
        );
        if (!deleted.rows[0]) return reply.code(409).send({ error: 'version_conflict' });
        return { deleted: true, resource: dto(deleted.rows[0]) };
      }),
  );
}
