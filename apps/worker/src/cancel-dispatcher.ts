import type { Client } from '@temporalio/client';
import type { Pool } from 'pg';
import { workflowIdForRun } from './outbox-dispatcher';

type CancelClaim = {
  event_id: string;
  task_id: string;
  run_id: string;
  claim_token: string;
  attempts: number;
};

export type CancelDispatchResult = {
  claimed: number;
  signaled: number;
  absent: number;
  deferred: number;
  skipped: number;
  failed: number;
};

/** Signal the deterministic Workflow only after its start event has settled. */
export async function dispatchTaskCancelBatch(
  pool: Pool,
  signalWorkflow: (runId: string, workflowId: string) => Promise<'SIGNALED' | 'NOT_FOUND'>,
  limit = 10,
): Promise<CancelDispatchResult> {
  const claimed = await pool.query<CancelClaim>('SELECT * FROM ayra.claim_task_cancel_events($1)', [
    limit,
  ]);
  const result: CancelDispatchResult = {
    claimed: claimed.rows.length,
    signaled: 0,
    absent: 0,
    deferred: 0,
    skipped: 0,
    failed: 0,
  };
  for (const event of claimed.rows) {
    try {
      const state = await pool.query<{ state: string }>(
        'SELECT ayra.task_cancel_dispatch_state($1, $2) AS state',
        [event.task_id, event.run_id],
      );
      if (state.rows[0]?.state === 'WAIT_START') {
        result.deferred += 1;
        continue;
      }
      if (state.rows[0]?.state === 'READY') {
        const outcome = await signalWorkflow(event.run_id, workflowIdForRun(event.run_id));
        if (outcome === 'SIGNALED') result.signaled += 1;
        else result.absent += 1;
      } else {
        result.skipped += 1;
      }
      const ack = await pool.query<{ acknowledged: boolean }>(
        'SELECT ayra.ack_task_cancel_event($1, $2) AS acknowledged',
        [event.event_id, event.claim_token],
      );
      if (!ack.rows[0]?.acknowledged)
        throw new Error('Cancel Outbox claim expired before acknowledge');
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

/** A missing Workflow is safe only after the matching start event was acknowledged. */
export async function signalTaskCancellation(client: Client, runId: string) {
  try {
    await client.workflow.getHandle(workflowIdForRun(runId)).signal('cancelTask');
    return 'SIGNALED' as const;
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowNotFoundError')
      return 'NOT_FOUND' as const;
    throw error;
  }
}
