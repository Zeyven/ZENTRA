import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';

const connection = await NativeConnection.connect({
  address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
});
try {
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
    taskQueue: process.env.AYRA_PROBE_TASK_QUEUE ?? 'ayra-durability-probe',
    workflowsPath: fileURLToPath(new URL('../src/durability-probe.workflow.ts', import.meta.url)),
  });
  console.info('AYRA_PROBE_WORKER_READY');
  await worker.run();
} finally {
  await connection.close();
}
