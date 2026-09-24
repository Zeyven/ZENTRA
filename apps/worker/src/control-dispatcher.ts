import type { Client } from '@temporalio/client';
import type { Pool } from 'pg';
import { workflowIdForRun } from './outbox-dispatcher';

type ControlClaim = {
  event_id: string;
  task_id: string;
  run_id: string;
  action: 'PAUSE' | 'RESUME';
  claim_token: string;
  attempts: number;
};

export type ControlDispatchResult = {
  claimed: number;
  signaled: number;
  deferred: number;
  skipped: number;
  failed: number;
};

/** Reconcile each event with the latest canonical Task before signaling. */
export async function dispatchTaskControlBatch(
  pool: Pool,
  signalWorkflow: (runId: string, action: 'PAUSE' | 'RESUME') => Promise<void>,
  limit = 10,
): Promise<ControlDispatchResult> {
  const claimed = await pool.query<ControlClaim>(
    'SELECT * FROM ayra.claim_task_control_events($1)',
    [limit],
  );
  const result: ControlDispatchResult = {
    claimed: claimed.rows.length,
    signaled: 0,
    deferred: 0,
    skipped: 0,
    failed: 0,
  };
  for (const event of claimed.rows) {
    try {
      const state = await pool.query<{ state: string }>(
        'SELECT ayra.task_control_dispatch_state($1, $2, $3) AS state',
        [event.event_id, event.task_id, event.run_id],
      );
      if (state.rows[0]?.state === 'WAIT_START') {
        result.deferred += 1;
        continue;
      }
      if (state.rows[0]?.state === event.action) {
        await signalWorkflow(event.run_id, event.action);
        result.signaled += 1;
      } else {
        result.skipped += 1;
      }
      const ack = await pool.query<{ acknowledged: boolean }>(
        'SELECT ayra.ack_task_control_event($1, $2) AS acknowledged',
        [event.event_id, event.claim_token],
      );
      if (!ack.rows[0]?.acknowledged)
        throw new Error('Task control claim expired before acknowledge');
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export async function signalTaskControl(client: Client, runId: string, action: 'PAUSE' | 'RESUME') {
  await client.workflow
    .getHandle(workflowIdForRun(runId))
    .signal(action === 'PAUSE' ? 'pauseTask' : 'resumeTask');
}
