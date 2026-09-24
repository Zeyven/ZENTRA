import type { Pool } from 'pg';

export type WorkerApprovalRequest = Readonly<{
  runId: string;
  targetUserId: string;
  action: string;
  resourceRef: string;
  argumentsHash: string;
  expiresAt: Date;
  requestKey: string;
}>;

export type WorkerApprovalReceipt = Readonly<{
  approvalId: string;
  stateVersion: number;
  expiresAt: string;
}>;

/** Atomically enters WAITING_APPROVAL and creates one request per Run/key. */
export function createApprovalRequester(pool: Pool) {
  return async (input: WorkerApprovalRequest): Promise<WorkerApprovalReceipt> => {
    const result = await pool.query<{
      result_code: string;
      approval_id: string | null;
      task_version: string | null;
    }>('SELECT * FROM ayra.worker_request_approval($1,$2,$3,$4,$5,$6,$7)', [
      input.runId,
      input.targetUserId,
      input.action,
      input.resourceRef,
      input.argumentsHash,
      input.expiresAt,
      input.requestKey,
    ]);
    const row = result.rows[0];
    if (
      !row ||
      !['REQUESTED', 'REPLAY'].includes(row.result_code) ||
      !row.approval_id ||
      !row.task_version
    )
      throw new Error(`Canonical Approval request rejected: ${row?.result_code ?? 'UNKNOWN'}`);
    return {
      approvalId: row.approval_id,
      stateVersion: Number(row.task_version),
      expiresAt: input.expiresAt.toISOString(),
    };
  };
}
