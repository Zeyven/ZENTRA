import { workspacePolicy } from '@ayra/auth';
import type { WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { claimIdempotency, finishIdempotency, readIdempotencyKey } from './idempotency';
import { roleInWorkspace } from './membership';
import type { Services } from './request-context';
import { runAuthorized } from './request-context';

type ConversationRow = {
  id: string;
  workspace_id: WorkspaceId;
  project_id: string | null;
  title: string;
  version: string;
  archived_at: Date | null;
};
const fields = 'id, workspace_id, project_id, title, version, archived_at';
const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;
function dto(row: ConversationRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    title: row.title,
    version: Number(row.version),
    archivedAt: row.archived_at,
  };
}
function denied(reply: FastifyReply, reason: string) {
  return reason === 'NO_MEMBERSHIP'
    ? reply.code(404).send({ error: 'conversation_not_found' })
    : reply.code(403).send({ error: 'forbidden' });
}

export function registerConversationRoutes(app: FastifyInstance, services: Services) {
  app.post<{ Body: { workspaceId: string; projectId?: string; title: string } }>(
    '/v1/conversations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['workspaceId', 'title'],
          additionalProperties: false,
          properties: {
            workspaceId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 1, maxLength: 240 },
          },
        },
      },
    },
    async (request, reply) => {
      const title = request.body.title.trim();
      if (!title) return reply.code(400).send({ error: 'invalid_conversation_title' });
      const key = readIdempotencyKey(request.headers['idempotency-key']);
      if (!key) return reply.code(400).send({ error: 'idempotency_key_required' });
      const workspaceId = request.body.workspaceId as WorkspaceId;
      const projectId = request.body.projectId ?? null;
      const hash = createHash('sha256')
        .update(JSON.stringify({ workspaceId, projectId, title }))
        .digest('hex');
      const outcome = await runAuthorized(services, request, reply, async (client, actor) => {
        const role = await roleInWorkspace(client, actor, workspaceId);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'conversation:create',
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
        const claim = await claimIdempotency(client, workspaceId, 'conversation:create', key, hash);
        if (claim.kind === 'conflict')
          return reply.code(409).send({ error: 'idempotency_key_conflict' });
        if (claim.kind === 'replay') {
          const previous = await client.query<ConversationRow>(
            `SELECT ${fields} FROM conversations WHERE id = $1`,
            [claim.resultRef],
          );
          if (!previous.rows[0]) throw new Error('Idempotency Conversation missing');
          return dto(previous.rows[0]);
        }
        const inserted = await client.query<ConversationRow>(
          `INSERT INTO conversations(workspace_id, project_id, title, created_by)
           VALUES ($1, $2, $3, $4) RETURNING ${fields}`,
          [workspaceId, projectId, title, actor],
        );
        const conversation = inserted.rows[0];
        if (!conversation) throw new Error('Conversation insert returned no row');
        await finishIdempotency(client, claim.recordId, conversation.id);
        return dto(conversation);
      });
      if (reply.sent) return reply;
      return reply.code(201).send(outcome);
    },
  );

  app.get<{ Querystring: { workspaceId: string; archived?: string } }>(
    '/v1/conversations',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['workspaceId'],
          additionalProperties: false,
          properties: {
            workspaceId: { type: 'string', format: 'uuid' },
            archived: { type: 'string', enum: ['true', 'false'] },
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
          action: 'conversation:read',
          workspaceId,
          membership: role ? { workspaceId, role, status: 'ACTIVE' } : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const result = await client.query<ConversationRow>(
          `SELECT ${fields} FROM conversations
           WHERE workspace_id = $1 AND ((archived_at IS NOT NULL) = $2)
           ORDER BY created_at DESC, id DESC`,
          [workspaceId, request.query.archived === 'true'],
        );
        return { conversations: result.rows.map(dto) };
      }),
  );

  app.get<{ Params: { id: string } }>(
    '/v1/conversations/:id',
    { schema: { params: uuidParam } },
    async (request, reply) =>
      runAuthorized(services, request, reply, async (client, actor) => {
        const result = await client.query<ConversationRow>(
          `SELECT ${fields} FROM conversations WHERE id = $1 AND archived_at IS NULL`,
          [request.params.id],
        );
        const conversation = result.rows[0];
        if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
        const role = await roleInWorkspace(client, actor, conversation.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'conversation:read',
          workspaceId: conversation.workspace_id,
          membership: role
            ? { workspaceId: conversation.workspace_id, role, status: 'ACTIVE' }
            : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        return dto(conversation);
      }),
  );

  app.patch<{ Params: { id: string }; Body: { version: number; title: string } }>(
    '/v1/conversations/:id',
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
      if (!title) return reply.code(400).send({ error: 'invalid_conversation_title' });
      return runAuthorized(services, request, reply, async (client, actor) => {
        const result = await client.query<ConversationRow>(
          `SELECT ${fields} FROM conversations WHERE id = $1 AND archived_at IS NULL`,
          [request.params.id],
        );
        const conversation = result.rows[0];
        if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
        const role = await roleInWorkspace(client, actor, conversation.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'conversation:update',
          workspaceId: conversation.workspace_id,
          membership: role
            ? { workspaceId: conversation.workspace_id, role, status: 'ACTIVE' }
            : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const updated = await client.query<ConversationRow>(
          `UPDATE conversations SET title = $2, version = version + 1, updated_by = $3
           WHERE id = $1 AND version = $4 AND archived_at IS NULL RETURNING ${fields}`,
          [conversation.id, title, actor, request.body.version],
        );
        if (!updated.rows[0]) return reply.code(409).send({ error: 'version_conflict' });
        return dto(updated.rows[0]);
      });
    },
  );

  for (const action of ['archive', 'restore'] as const) {
    app.post<{ Params: { id: string }; Body: { version: number } }>(
      `/v1/conversations/:id/${action}`,
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
          const result = await client.query<ConversationRow>(
            `SELECT ${fields} FROM conversations WHERE id = $1`,
            [request.params.id],
          );
          const conversation = result.rows[0];
          if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
          const role = await roleInWorkspace(client, actor, conversation.workspace_id);
          const decision = workspacePolicy.authorize({
            actor,
            action: action === 'archive' ? 'conversation:archive' : 'conversation:restore',
            workspaceId: conversation.workspace_id,
            membership: role
              ? { workspaceId: conversation.workspace_id, role, status: 'ACTIVE' }
              : null,
          });
          if (!decision.allowed) return denied(reply, decision.reason);
          if ((action === 'archive') !== (conversation.archived_at === null))
            return reply.code(409).send({ error: 'invalid_conversation_state' });
          const updated = await client.query<ConversationRow>(
            `UPDATE conversations SET archived_at = ${action === 'archive' ? 'now()' : 'NULL'},
             version = version + 1, updated_by = $2
             WHERE id = $1 AND version = $3
               AND archived_at IS ${action === 'archive' ? 'NULL' : 'NOT NULL'}
             RETURNING ${fields}`,
            [conversation.id, actor, request.body.version],
          );
          if (!updated.rows[0]) return reply.code(409).send({ error: 'version_conflict' });
          return dto(updated.rows[0]);
        }),
    );
  }
}
