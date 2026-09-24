import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createApprovalConsumer } from './approval-consumer';

const binding = {
  approvalId: 'approval-a',
  workspaceId: 'workspace-a',
  runOwnerId: 'owner-a',
  taskId: 'task-a',
  runId: 'run-a',
  action: 'repo.push@1',
  resourceRef: 'repo-a',
  argumentsHash: 'a'.repeat(64),
  stateVersion: 7,
};

function fixture(outcome: 'CONSUMED' | 'INVALID' | 'ERROR') {
  const statements: string[] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    statements.push(sql);
    if (sql.includes('ayra.consume_approval')) {
      if (params?.length !== 6) throw new Error('MISSING_APPROVAL_BINDING');
      if (outcome === 'ERROR') throw new Error('DB_UNAVAILABLE');
      return { rows: [{ outcome }] };
    }
    return { rows: [] };
  });
  const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, statements, release, query };
}

describe('Worker Approval consumer', () => {
  it('commits exactly one successful decision in an actor-scoped transaction', async () => {
    const { pool, statements, release, query } = fixture('CONSUMED');
    expect(await createApprovalConsumer(pool).consume(binding)).toBe(true);
    expect(statements).toEqual([
      'BEGIN',
      "SELECT set_config('ayra.actor_user_id', $1, true)",
      'SELECT ayra.consume_approval($1, $2, $3, $4, $5, $6) AS outcome',
      'COMMIT',
    ]);
    expect(query.mock.calls[1]?.[1]).toEqual(['owner-a']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back a database error and releases the connection', async () => {
    const { pool, statements, release } = fixture('ERROR');
    await expect(createApprovalConsumer(pool).consume(binding)).rejects.toThrow('DB_UNAVAILABLE');
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('commits a denied binding without consuming it', async () => {
    const { pool, statements } = fixture('INVALID');
    expect(await createApprovalConsumer(pool).consume(binding)).toBe(false);
    expect(statements.at(-1)).toBe('COMMIT');
  });
});
