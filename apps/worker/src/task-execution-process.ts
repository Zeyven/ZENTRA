import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import type { TaskActivities } from './task-activity-contract';
import { dispatchTaskStartBatch } from './outbox-dispatcher';
import { dispatchTaskCancelBatch, signalTaskCancellation } from './cancel-dispatcher';

type TaskExecutionOptions = {
  pool: Pool;
  activities: TaskActivities;
  address: string;
  namespace: string;
  taskQueue: string;
  signal: AbortSignal;
  pollIntervalMs?: number;
  onReady?: () => void;
};

/** Requires an injected real Agent adapter; no synthetic output is available here. */
export async function runTaskExecutionProcess(options: TaskExecutionOptions): Promise<void> {
  const native = await NativeConnection.connect({ address: options.address });
  let clientConnection: Connection | undefined;
  let worker: Worker | undefined;
  let workerPromise: Promise<void> | undefined;
  const stopped = new AbortController();
  let workerFailure: unknown;
  try {
    clientConnection = await Connection.connect({ address: options.address });
    const client = new Client({ connection: clientConnection, namespace: options.namespace });
    worker = await Worker.create({
      connection: native,
      namespace: options.namespace,
      taskQueue: options.taskQueue,
      workflowsPath: fileURLToPath(new URL('./task.workflow.ts', import.meta.url)),
      activities: options.activities,
    });
    workerPromise = worker.run().catch((error: unknown) => {
      workerFailure = error;
      stopped.abort();
    });
    options.onReady?.();
    while (!options.signal.aborted && !stopped.signal.aborted) {
      await dispatchTaskStartBatch(options.pool, (runId, workflowId) =>
        client.workflow
          .start('taskWorkflow', {
            args: [runId],
            workflowId,
            taskQueue: options.taskQueue,
          })
          .then(() => undefined),
      );
      await dispatchTaskCancelBatch(options.pool, (runId) => signalTaskCancellation(client, runId));
      if (workerFailure) throw workerFailure;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          options.signal.removeEventListener('abort', done);
          stopped.signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, options.pollIntervalMs ?? 500);
        options.signal.addEventListener('abort', done, { once: true });
        stopped.signal.addEventListener('abort', done, { once: true });
      });
    }
    if (workerFailure) throw workerFailure;
  } finally {
    worker?.shutdown();
    await workerPromise;
    await clientConnection?.close();
    await native.close();
  }
}
