import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import type { Pool } from 'pg';

type StartClaim = {
  event_id: string;
  workspace_id: string;
  task_id: string;
  run_id: string;
  claim_token: string;
  attempts: number;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable across delivery retries; Temporal's own Run ID is only a provider reference. */
export function workflowIdForRun(runId: string): string {
  if (!uuid.test(runId)) throw new Error('Invalid AYRA Run ID');
  return `ayra-run-${runId.toLowerCase()}`;
}

export type DispatchBatchResult = {
  claimed: number;
  started: number;
  duplicate: number;
  skipped: number;
  failed: number;
};

/** One bounded Outbox pass. The injected starter owns the Temporal connection. */
export async function dispatchTaskStartBatch(
  pool: Pool,
  startWorkflow: (runId: string, workflowId: string, initiallyPaused: boolean) => Promise<void>,
  limit = 10,
): Promise<DispatchBatchResult> {
  const claimed = await pool.query<StartClaim>('SELECT * FROM ayra.claim_task_start_events($1)', [
    limit,
  ]);
  const result: DispatchBatchResult = {
    claimed: claimed.rows.length,
    started: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
  };
  for (const event of claimed.rows) {
    try {
      const state = await pool.query<{ state: string }>(
        'SELECT ayra.task_start_dispatch_state($1, $2) AS state',
        [event.task_id, event.run_id],
      );
      if (state.rows[0]?.state === 'READY' || state.rows[0]?.state === 'PAUSED') {
        try {
          await startWorkflow(
            event.run_id,
            workflowIdForRun(event.run_id),
            state.rows[0].state === 'PAUSED',
          );
          result.started += 1;
        } catch (error) {
          if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
          result.duplicate += 1;
        }
      } else {
        result.skipped += 1;
      }
      const ack = await pool.query<{ acknowledged: boolean }>(
        'SELECT ayra.ack_task_start_event($1, $2) AS acknowledged',
        [event.event_id, event.claim_token],
      );
      if (!ack.rows[0]?.acknowledged) throw new Error('Outbox claim expired before acknowledge');
    } catch {
      // Leave the event unacknowledged. Its lease expires and it can be retried.
      result.failed += 1;
    }
  }
  return result;
}
