import { Client, Connection } from '@temporalio/client';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { workflowIdForRun } from '../src/outbox-dispatcher';
import { signalTaskCancellation } from '../src/cancel-dispatcher';

const envPath = resolve('.env.local');
if (existsSync(envPath)) loadEnvFile(envPath);
const taskQueue = `ayra-task-workflow-test-${randomUUID()}`;
const workerPath = fileURLToPath(new URL('./task-workflow-worker.ts', import.meta.url));
const workers = new Set<ChildProcessWithoutNullStreams>();

function startWorker(): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, ['--import', 'tsx', workerPath], {
    cwd: process.cwd(),
    env: { ...process.env, AYRA_TEST_TASK_QUEUE: taskQueue },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  workers.add(child);
  return new Promise((resolveReady, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Task Workflow Worker did not become ready: ${output.slice(-1000)}`));
    }, 30_000);
    const receive = (data: Buffer) => {
      output += data.toString();
      if (output.includes('AYRA_TASK_WORKFLOW_WORKER_READY')) {
        clearTimeout(timeout);
        resolveReady(child);
      }
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      workers.delete(child);
      clearTimeout(timeout);
      if (!output.includes('AYRA_TASK_WORKFLOW_WORKER_READY'))
        reject(new Error(`Task Workflow Worker exited ${code}: ${output.slice(-1000)}`));
    });
  });
}

async function waitForStage(handle: ReturnType<Client['workflow']['getHandle']>, expected: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await handle.query<string>('taskStage')) === expected) return;
    } catch {
      // The first workflow task may not have run yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Task Workflow did not reach ${expected}`);
}

const connection = await Connection.connect({
  address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
});
const client = new Client({
  connection,
  namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
});
const workflowIds: string[] = [];
try {
  const first = await startWorker();
  const runId = randomUUID();
  const workflowId = workflowIdForRun(runId);
  workflowIds.push(workflowId);
  const handle = await client.workflow.start('taskWorkflow', {
    args: [runId],
    workflowId,
    taskQueue,
  });
  await handle.signal('pauseTask');
  await waitForStage(handle, 'PAUSED');
  const exited = new Promise<void>((resolveExit) => first.once('exit', () => resolveExit()));
  first.kill('SIGKILL');
  await exited;
  await startWorker();
  await waitForStage(handle, 'PAUSED');
  await handle.signal('resumeTask');
  const completed = await handle.result();
  if (completed?.runId !== runId || completed.status !== 'COMPLETED')
    throw new Error(`Task Workflow recovery returned ${JSON.stringify(completed)}`);

  const canceledRunId = randomUUID();
  const canceledWorkflowId = workflowIdForRun(canceledRunId);
  workflowIds.push(canceledWorkflowId);
  const cancelHandle = await client.workflow.start('taskWorkflow', {
    args: [canceledRunId],
    workflowId: canceledWorkflowId,
    taskQueue,
  });
  await cancelHandle.signal('pauseTask');
  await waitForStage(cancelHandle, 'PAUSED');
  if ((await signalTaskCancellation(client, canceledRunId)) !== 'SIGNALED')
    throw new Error('Existing Task Workflow was not signaled for cancellation');
  const canceled = await cancelHandle.result();
  if (canceled?.runId !== canceledRunId || canceled.status !== 'CANCELED')
    throw new Error(`Task Workflow cancel returned ${JSON.stringify(canceled)}`);
  if ((await signalTaskCancellation(client, randomUUID())) !== 'NOT_FOUND')
    throw new Error('Missing Task Workflow was not recognized as absent');
  console.info('PASS: TaskWorkflow survived Worker SIGKILL, resumed, completed, and canceled.');
} finally {
  for (const workflowId of workflowIds) {
    try {
      await client.workflow.getHandle(workflowId).terminate('Task Workflow test cleanup');
    } catch {
      // Completed Workflow cannot be terminated.
    }
  }
  for (const worker of workers) worker.kill('SIGKILL');
  await connection.close();
}
