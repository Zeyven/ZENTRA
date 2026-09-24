import { workspacePolicy } from '@ayra/auth';
import type { UserId, WorkspaceId } from '@ayra/domain';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { roleInWorkspace } from './membership';
import { runStreamAuthorized, type Services } from './request-context';

type TaskEvent = {
  id: string;
  type: string;
  version: number;
  payload: Record<string, unknown>;
  createdAt: Date;
};

async function readEvents(
  client: PoolClient,
  actor: UserId,
  taskId: string,
  afterVersion: number,
): Promise<{ found: false } | { found: true; events: TaskEvent[] }> {
  const task = await client.query<{ workspace_id: WorkspaceId }>(
    'SELECT workspace_id FROM tasks WHERE id = $1 AND deleted_at IS NULL',
    [taskId],
  );
  const workspaceId = task.rows[0]?.workspace_id;
  if (!workspaceId) return { found: false };
  const role = await roleInWorkspace(client, actor, workspaceId);
  const decision = workspacePolicy.authorize({
    actor,
    action: 'task:read',
    workspaceId,
    membership: role ? { workspaceId, role, status: 'ACTIVE' } : null,
  });
  if (!decision.allowed) return { found: false };
  const result = await client.query<{
    id: string;
    event_type: string;
    event_version: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, event_type, event_version, payload, created_at
       FROM ayra.read_task_events($1, $2, 50)`,
    [taskId, afterVersion],
  );
  return {
    found: true,
    events: result.rows.map((row) => ({
      id: row.id,
      type: row.event_type,
      version: Number(row.event_version),
      payload: row.payload,
      createdAt: row.created_at,
    })),
  };
}

export function registerTaskEventStream(app: FastifyInstance, services: Services) {
  app.get<{ Params: { id: string }; Querystring: { afterVersion?: number } }>(
    '/v1/tasks/:id/events/stream',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { afterVersion: { type: 'integer', minimum: 0 } },
        },
      },
    },
    async (request, reply) => {
      const lastEventId = request.headers['last-event-id'];
      const headerCursor = typeof lastEventId === 'string' ? Number(lastEventId) : 0;
      const initialCursor = request.query.afterVersion ?? headerCursor;
      if (!Number.isSafeInteger(initialCursor) || initialCursor < 0)
        return reply.code(400).send({ error: 'invalid_event_cursor' });
      const authorization = request.headers.authorization;
      const read = (cursor: number) =>
        runStreamAuthorized(services, authorization, (client, actor) =>
          readEvents(client, actor, request.params.id, cursor),
        );
      const initial = await read(initialCursor);
      if (!initial.ok) return reply.code(initial.status).send({ error: 'stream_unavailable' });
      if (!initial.value.found) return reply.code(404).send({ error: 'task_not_found' });

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      let cursor = initialCursor;
      let closed = false;
      let polling = false;
      let idlePolls = 0;
      const send = (events: TaskEvent[]) => {
        for (const event of events) {
          if (closed || reply.raw.destroyed) return;
          reply.raw.write(
            `id: ${event.version}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
          cursor = event.version;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        if (!reply.raw.destroyed) reply.raw.end();
      };
      reply.raw.write(': connected\n\n');
      send(initial.value.events);
      const timer = setInterval(() => {
        if (polling || closed || reply.raw.destroyed) return;
        polling = true;
        void read(cursor)
          .then((next) => {
            if (closed) return;
            if (!next.ok || !next.value.found) {
              close();
              return;
            }
            send(next.value.events);
            idlePolls = next.value.events.length ? 0 : idlePolls + 1;
            if (idlePolls >= 15) {
              reply.raw.write(': keepalive\n\n');
              idlePolls = 0;
            }
          })
          .catch(() => close())
          .finally(() => {
            polling = false;
          });
      }, 1000);
      reply.raw.once('close', close);
    },
  );
}
