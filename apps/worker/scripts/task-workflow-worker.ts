import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import type { TaskActivities } from '../src/task-activity-contract';

/** Test-only Activities. The production DB/AgentRuntime adapter is not wired yet. */
const activities: TaskActivities = {
  async loadTask(runId) {
    return { taskId: runId, goal: 'Verify a durable Task Workflow', type: 'TEST' };
  },
  async enterStage() {},
  async understand(_runId, goal) {
    return `understood: ${goal}`;
  },
  async plan(_runId, understanding) {
    return `plan: ${understanding}`;
  },
  async execute(_runId, plan) {
    return `output: ${plan}`;
  },
  async verify(_runId, output) {
    return output.startsWith('output: plan: understood:');
  },
  async completeRun() {},
  async cancelRun() {},
  async failRun() {},
};

const connection = await NativeConnection.connect({
  address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
});
try {
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
    taskQueue: process.env.AYRA_TEST_TASK_QUEUE ?? 'ayra-task-workflow-test',
    workflowsPath: fileURLToPath(new URL('../src/task.workflow.ts', import.meta.url)),
    activities,
  });
  console.info('AYRA_TASK_WORKFLOW_WORKER_READY');
  await worker.run();
} finally {
  await connection.close();
}
