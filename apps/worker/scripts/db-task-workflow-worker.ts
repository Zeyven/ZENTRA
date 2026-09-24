import { NativeConnection, Worker } from '@temporalio/worker';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createTaskActivities } from '../src/task-activities';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for M3 integration Worker');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const connection = await NativeConnection.connect({
  address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
});
try {
  const activities = createTaskActivities(
    pool,
    {
      async understand(_runId, goal) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
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
    },
    async () => {
      // Test-only output sink. Production must persist and authorize an Artifact.
    },
  );
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
    taskQueue: process.env.AYRA_TEST_TASK_QUEUE ?? 'ayra-db-task-test',
    workflowsPath: fileURLToPath(new URL('../src/task.workflow.ts', import.meta.url)),
    activities,
  });
  console.info('AYRA_DB_TASK_WORKER_READY');
  await worker.run();
} finally {
  await pool.end();
  await connection.close();
}
