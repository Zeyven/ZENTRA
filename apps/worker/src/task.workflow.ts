import {
  ApplicationFailure,
  CancellationScope,
  condition,
  defineQuery,
  defineSignal,
  isCancellation,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type { TaskActivities } from './task-activity-contract';

export type TaskWorkflowStage =
  | 'LOADING'
  | 'UNDERSTANDING'
  | 'PLANNING'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'PAUSED'
  | 'CANCELED'
  | 'FAILED';

export const pauseTaskSignal = defineSignal('pauseTask');
export const resumeTaskSignal = defineSignal('resumeTask');
export const cancelTaskSignal = defineSignal('cancelTask');
export const approvalDecisionSignal = defineSignal<[string]>('approvalDecision');
export const taskStageQuery = defineQuery<TaskWorkflowStage>('taskStage');

const load = proxyActivities<Pick<TaskActivities, 'loadTask'>>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});
const readOnly = proxyActivities<Pick<TaskActivities, 'understand' | 'plan' | 'verify'>>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 3 },
});
const approvalRead = proxyActivities<Pick<TaskActivities, 'approvalState'>>({
  startToCloseTimeout: '10 seconds',
  retry: { maximumAttempts: 3 },
});
const externalWrite = proxyActivities<Pick<TaskActivities, 'execute'>>({
  startToCloseTimeout: '30 minutes',
  retry: { maximumAttempts: 1 },
});
const canonicalWrite = proxyActivities<
  Pick<TaskActivities, 'enterStage' | 'completeRun' | 'cancelRun' | 'failRun'>
>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 1 },
});

/** Temporal owns durability; Activity implementations own AYRA's canonical DB state. */
export async function taskWorkflow(runId: string): Promise<{ runId: string; status: string }> {
  let stage: TaskWorkflowStage = 'LOADING';
  let paused = false;
  let canceled = false;
  let approvalWakeCounter = 0;
  let pendingApprovalId: string | null = null;
  setHandler(taskStageQuery, () => (paused ? 'PAUSED' : stage));
  setHandler(pauseTaskSignal, () => {
    paused = true;
  });
  setHandler(resumeTaskSignal, () => {
    paused = false;
  });
  setHandler(cancelTaskSignal, () => {
    canceled = true;
  });
  setHandler(approvalDecisionSignal, (approvalId) => {
    if (approvalId === pendingApprovalId) approvalWakeCounter += 1;
  });

  const beforeStage = async () => {
    await condition(() => !paused || canceled);
    if (canceled) {
      await canonicalWrite.cancelRun(runId);
      stage = 'CANCELED';
      return false;
    }
    return true;
  };
  try {
    const task = await load.loadTask(runId);
    if (!(await beforeStage())) return { runId, status: 'CANCELED' };
    await canonicalWrite.enterStage(runId, 'UNDERSTANDING');
    stage = 'UNDERSTANDING';
    const understanding = await readOnly.understand(runId, task.goal);

    if (!(await beforeStage())) return { runId, status: 'CANCELED' };
    await canonicalWrite.enterStage(runId, 'PLANNING');
    stage = 'PLANNING';
    const plan = await readOnly.plan(runId, understanding);

    if (!(await beforeStage())) return { runId, status: 'CANCELED' };
    await canonicalWrite.enterStage(runId, 'RUNNING');
    stage = 'RUNNING';
    let execution = await externalWrite.execute(runId, plan);
    if (typeof execution !== 'string') {
      if (
        execution.kind !== 'APPROVAL_REQUIRED' ||
        !execution.approvalId ||
        !Number.isSafeInteger(execution.stateVersion) ||
        execution.stateVersion < 1
      )
        throw new Error('INVALID_APPROVAL_WAIT');
      pendingApprovalId = execution.approvalId;
      stage = 'WAITING_APPROVAL';
      while (true) {
        if (!(await beforeStage())) return { runId, status: 'CANCELED' };
        const state = await approvalRead.approvalState(
          runId,
          execution.approvalId,
          execution.stateVersion,
        );
        if (state === 'APPROVED') break;
        if (state !== 'PENDING') throw new Error(`APPROVAL_${state}`);
        const observedWake = approvalWakeCounter;
        await condition(() => canceled || approvalWakeCounter !== observedWake, '15 seconds');
      }
      pendingApprovalId = null;
      if (!(await beforeStage())) return { runId, status: 'CANCELED' };
      execution = await externalWrite.execute(runId, plan, {
        approvalId: execution.approvalId,
        stateVersion: execution.stateVersion,
      });
      if (typeof execution !== 'string') throw new Error('REPEATED_APPROVAL_REQUIRED');
      await canonicalWrite.enterStage(runId, 'RUNNING');
      stage = 'RUNNING';
    }
    const output = execution;

    if (!(await beforeStage())) return { runId, status: 'CANCELED' };
    await canonicalWrite.enterStage(runId, 'VERIFYING');
    stage = 'VERIFYING';
    const verified = await readOnly.verify(runId, output);
    if (!verified) throw new Error('VERIFICATION_FAILED');
    if (!(await beforeStage())) return { runId, status: 'CANCELED' };
    await canonicalWrite.completeRun(runId, output);
    stage = 'COMPLETED';
    return { runId, status: 'COMPLETED' };
  } catch (error) {
    const cancellation = canceled || isCancellation(error);
    await CancellationScope.nonCancellable(async () => {
      if (cancellation) {
        await canonicalWrite.cancelRun(runId);
        stage = 'CANCELED';
      } else {
        await canonicalWrite.failRun(
          runId,
          error instanceof Error && error.message === 'VERIFICATION_FAILED'
            ? 'VERIFICATION_FAILED'
            : 'TASK_ACTIVITY_FAILED',
        );
        stage = 'FAILED';
      }
    });
    if (cancellation) return { runId, status: 'CANCELED' };
    throw ApplicationFailure.create({
      message: error instanceof Error ? error.message : 'TASK_ACTIVITY_FAILED',
      type: 'AYRA_TASK_FAILED',
      nonRetryable: true,
    });
  }
}
