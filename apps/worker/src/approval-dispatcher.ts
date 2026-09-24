import type { Client } from '@temporalio/client';
import type { Pool } from 'pg';
import { workflowIdForRun } from './outbox-dispatcher';

type ApprovalClaim = {
  event_id: string;
  approval_id: string;
  run_id: string;
  claim_token: string;
  attempts: number;
};

export type ApprovalDispatchResult = {
  claimed: number;
  signaled: number;
  absent: number;
  skipped: number;
  failed: number;
};

/** Signal is only a wakeup; the Workflow rechecks canonical Approval state. */
export async function dispatchApprovalDecisionBatch(
  pool: Pool,
  signalWorkflow: (runId: string, approvalId: string) => Promise<'SIGNALED' | 'NOT_FOUND'>,
  limit = 10,
): Promise<ApprovalDispatchResult> {
  const claimed = await pool.query<ApprovalClaim>(
    'SELECT * FROM ayra.claim_approval_decision_events($1)',
    [limit],
  );
  const result: ApprovalDispatchResult = {
    claimed: claimed.rows.length,
    signaled: 0,
    absent: 0,
    skipped: 0,
    failed: 0,
  };
  for (const event of claimed.rows) {
    try {
      const state = await pool.query<{ state: string }>(
        'SELECT ayra.approval_decision_dispatch_state($1, $2, $3) AS state',
        [event.event_id, event.approval_id, event.run_id],
      );
      if (state.rows[0]?.state === 'READY') {
        const outcome = await signalWorkflow(event.run_id, event.approval_id);
        if (outcome === 'SIGNALED') result.signaled += 1;
        else result.absent += 1;
      } else {
        result.skipped += 1;
      }
      const ack = await pool.query<{ acknowledged: boolean }>(
        'SELECT ayra.ack_approval_decision_event($1, $2) AS acknowledged',
        [event.event_id, event.claim_token],
      );
      if (!ack.rows[0]?.acknowledged)
        throw new Error('Approval decision claim expired before acknowledge');
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export async function signalApprovalDecision(client: Client, runId: string, approvalId: string) {
  try {
    await client.workflow.getHandle(workflowIdForRun(runId)).signal('approvalDecision', approvalId);
    return 'SIGNALED' as const;
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowNotFoundError')
      return 'NOT_FOUND' as const;
    throw error;
  }
}
