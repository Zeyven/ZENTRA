import type { WorkspaceId } from '@ayra/domain';
import type { PoolClient } from 'pg';

export type IdempotencyClaim =
  | { readonly kind: 'new'; readonly recordId: string }
  | { readonly kind: 'replay'; readonly resultRef: string }
  | { readonly kind: 'conflict' };

export async function claimIdempotency(
  client: PoolClient,
  workspaceId: WorkspaceId,
  scope: string,
  key: string,
  requestHash: string,
): Promise<IdempotencyClaim> {
  const reservation = await client.query<{ id: string }>(
    `INSERT INTO idempotency_records(workspace_id, scope, key, request_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '24 hours')
     ON CONFLICT (workspace_id, scope, key) DO NOTHING RETURNING id`,
    [workspaceId, scope, key, requestHash],
  );
  const recordId = reservation.rows[0]?.id;
  if (recordId) return { kind: 'new', recordId };
  const previous = await client.query<{ request_hash: string; result_ref: string | null }>(
    `SELECT request_hash, result_ref FROM idempotency_records
     WHERE workspace_id = $1 AND scope = $2 AND key = $3 FOR UPDATE`,
    [workspaceId, scope, key],
  );
  const record = previous.rows[0];
  if (!record) throw new Error('Idempotency reservation missing');
  if (record.request_hash !== requestHash) return { kind: 'conflict' };
  if (!record.result_ref) throw new Error('Idempotency result missing');
  return { kind: 'replay', resultRef: record.result_ref };
}

export async function finishIdempotency(client: PoolClient, recordId: string, resultRef: string) {
  const result = await client.query(
    'UPDATE idempotency_records SET result_ref = $1 WHERE id = $2 AND result_ref IS NULL',
    [resultRef, recordId],
  );
  if (result.rowCount !== 1) throw new Error('Idempotency result could not be stored');
}

export function readIdempotencyKey(value: string | string[] | undefined) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128 ? value : null;
}
