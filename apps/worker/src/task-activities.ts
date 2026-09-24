import type { Pool } from 'pg';
import type { TaskActivities } from './task-activity-contract';

type AgentSteps = Pick<TaskActivities, 'understand' | 'plan' | 'execute' | 'verify'>;

/**
 * The Agent adapter and output canonicalizer are required dependencies.
 * A production Worker cannot silently fall back to synthetic AI results.
 * canonicalizeOutput must be idempotent for a given AYRA Run ID.
 */
export function createTaskActivities(
  pool: Pool,
  agent: AgentSteps,
  canonicalizeOutput: (runId: string, output: string) => Promise<void>,
): TaskActivities {
  const transition = async (runId: string, status: string) => {
    const result = await pool.query<{ outcome: string }>(
      'SELECT ayra.worker_task_transition($1, $2) AS outcome',
      [runId, status],
    );
    const outcome = result.rows[0]?.outcome;
    if (outcome !== 'UPDATED' && outcome !== 'UNCHANGED')
      throw new Error(`Canonical Task transition rejected: ${outcome ?? 'UNKNOWN'}`);
  };
  return {
    async loadTask(runId) {
      const result = await pool.query<{
        task_id: string;
        goal: string;
        task_type: string;
      }>('SELECT * FROM ayra.load_task_run($1)', [runId]);
      const task = result.rows[0];
      if (!task) throw new Error('Canonical Task Run is unavailable');
      return { taskId: task.task_id, goal: task.goal, type: task.task_type };
    },
    async enterStage(runId, stage) {
      await transition(runId, stage);
    },
    understand: agent.understand,
    plan: agent.plan,
    execute: agent.execute,
    verify: agent.verify,
    async completeRun(runId, output) {
      await canonicalizeOutput(runId, output);
      await transition(runId, 'COMPLETED');
    },
    async cancelRun(runId) {
      await transition(runId, 'CANCELED');
    },
    async failRun(runId) {
      await transition(runId, 'FAILED');
    },
  };
}
