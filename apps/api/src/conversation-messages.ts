import { workspacePolicy } from '@ayra/auth';
import type { WorkspaceId } from '@ayra/domain';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { claimIdempotency, finishIdempotency, readIdempotencyKey } from './idempotency';
import { roleInWorkspace } from './membership';
import { requireActiveProject } from './project-reference';
import type { Services } from './request-context';
import { runAuthorized, TransactionalConflictError } from './request-context';

type MessageRow = {
  id: string;
  conversation_id: string;
  workspace_id: WorkspaceId;
  sequence: string;
  author_kind: 'USER' | 'ASSISTANT';
  body: string;
  created_by: string;
  created_at: Date;
};
const fields =
  'id, conversation_id, workspace_id, sequence, author_kind, body, created_by, created_at';
const uuidParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;
function dto(row: MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    workspaceId: row.workspace_id,
    sequence: Number(row.sequence),
    authorKind: row.author_kind,
    body: row.body,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
function denied(reply: FastifyReply, reason: string) {
  return reason === 'NO_MEMBERSHIP'
    ? reply.code(404).send({ error: 'conversation_not_found' })
    : reply.code(403).send({ error: 'forbidden' });
}

/** Stores user communication only. This route never starts an Agent Run. */
export function registerConversationMessageRoutes(app: FastifyInstance, services: Services) {
  app.post<{ Params: { id: string }; Body: { body: string } }>(
    '/v1/conversations/:id/messages',
    {
      schema: {
        params: uuidParam,
        body: {
          type: 'object',
          required: ['body'],
          additionalProperties: false,
          properties: { body: { type: 'string', minLength: 1, maxLength: 20000 } },
        },
      },
      preValidation: async (request, reply) => {
        if (
          request.body &&
          typeof request.body === 'object' &&
          Object.keys(request.body).some((key) => key !== 'body')
        )
          return reply.code(400).send({ error: 'invalid_message_fields' });
      },
    },
    async (request, reply) => {
      const body = request.body.body;
      if (!body.trim()) return reply.code(400).send({ error: 'invalid_message_body' });
      const key = readIdempotencyKey(request.headers['idempotency-key']);
      if (!key) return reply.code(400).send({ error: 'idempotency_key_required' });
      const outcome = await runAuthorized(services, request, reply, async (client, actor) => {
        const result = await client.query<{
          id: string;
          workspace_id: WorkspaceId;
          project_id: string | null;
          archived_at: Date | null;
        }>('SELECT id, workspace_id, project_id, archived_at FROM conversations WHERE id = $1', [
          request.params.id,
        ]);
        const conversation = result.rows[0];
        if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
        const role = await roleInWorkspace(client, actor, conversation.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'conversation:message:create',
          workspaceId: conversation.workspace_id,
          membership: role
            ? { workspaceId: conversation.workspace_id, role, status: 'ACTIVE' }
            : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const hash = createHash('sha256')
          .update(JSON.stringify({ conversationId: conversation.id, body }))
          .digest('hex');
        const claim = await claimIdempotency(
          client,
          conversation.workspace_id,
          `conversation:message:create:${conversation.id}`,
          key,
          hash,
        );
        if (claim.kind === 'conflict')
          return reply.code(409).send({ error: 'idempotency_key_conflict' });
        if (claim.kind === 'replay') {
          const previous = await client.query<MessageRow>(
            `SELECT ${fields} FROM conversation_messages WHERE id = $1`,
            [claim.resultRef],
          );
          if (!previous.rows[0]) throw new Error('Idempotency Conversation Message missing');
          return dto(previous.rows[0]);
        }
        if (conversation.archived_at !== null)
          throw new TransactionalConflictError('Archived Conversation cannot receive messages');
        await requireActiveProject(client, conversation.workspace_id, conversation.project_id);
        const inserted = await client.query<{
          result_code: string;
          message_id: string | null;
        }>('SELECT result_code, message_id FROM ayra.append_user_conversation_message($1, $2)', [
          conversation.id,
          body,
        ]);
        if (inserted.rows[0]?.result_code !== 'CREATED' || !inserted.rows[0].message_id)
          throw new TransactionalConflictError('Conversation changed while appending message');
        const message = await client.query<MessageRow>(
          `SELECT ${fields} FROM conversation_messages WHERE id = $1`,
          [inserted.rows[0].message_id],
        );
        if (!message.rows[0]) throw new Error('Inserted Conversation Message missing');
        await finishIdempotency(client, claim.recordId, message.rows[0].id);
        return dto(message.rows[0]);
      });
      if (reply.sent) return reply;
      return reply.code(201).send(outcome);
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { afterSequence?: number; limit?: number };
  }>(
    '/v1/conversations/:id/messages',
    {
      schema: {
        params: uuidParam,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            afterSequence: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) =>
      runAuthorized(services, request, reply, async (client, actor) => {
        const result = await client.query<{ id: string; workspace_id: WorkspaceId }>(
          'SELECT id, workspace_id FROM conversations WHERE id = $1 AND archived_at IS NULL',
          [request.params.id],
        );
        const conversation = result.rows[0];
        if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
        const role = await roleInWorkspace(client, actor, conversation.workspace_id);
        const decision = workspacePolicy.authorize({
          actor,
          action: 'conversation:message:read',
          workspaceId: conversation.workspace_id,
          membership: role
            ? { workspaceId: conversation.workspace_id, role, status: 'ACTIVE' }
            : null,
        });
        if (!decision.allowed) return denied(reply, decision.reason);
        const afterSequence = request.query.afterSequence ?? 0;
        const messages = await client.query<MessageRow>(
          `SELECT ${fields} FROM conversation_messages
            WHERE conversation_id = $1 AND sequence > $2
            ORDER BY sequence ASC LIMIT $3`,
          [conversation.id, afterSequence, request.query.limit ?? 50],
        );
        return {
          conversationId: conversation.id,
          messages: messages.rows.map(dto),
          nextAfterSequence: messages.rows.at(-1)
            ? Number(messages.rows.at(-1)?.sequence)
            : afterSequence,
        };
      }),
  );
}
