import { Client, Connection } from '@temporalio/client';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const envPath = resolve('.env.local');
if (existsSync(envPath)) loadEnvFile(envPath);

const namespace = process.env.TEMPORAL_NAMESPACE ?? 'ayra-development';
const taskQueue = `ayra-durability-probe-${randomUUID()}`;
const workflowId = `ayra-durability-probe-${randomUUID()}`;
const token = randomUUID();
const workerPath = fileURLToPath(new URL('./probe-worker.ts', import.meta.url));
const workers = new Set<ChildProcessWithoutNullStreams>();

function startWorker(): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, ['--import', 'tsx', workerPath], {
    cwd: process.cwd(),
    env: { ...process.env, AYRA_PROBE_TASK_QUEUE: taskQueue },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  workers.add(child);
  return new Promise((resolveReady, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Probe Worker did not become ready: ${output.slice(-2000)}`));
    }, 30_000);
    const receive = (data: Buffer) => {
      output += data.toString();
      if (output.includes('AYRA_PROBE_WORKER_READY')) {
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
      if (!output.includes('AYRA_PROBE_WORKER_READY')) {
        reject(new Error(`Probe Worker exited ${code}: ${output.slice(-2000)}`));
      }
    });
  });
}

async function eventually<T>(action: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (accept(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Timed out waiting for Workflow state: ${String(lastError)}`);
}

const connection = await Connection.connect({
  address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
});
const client = new Client({ connection, namespace });
let handle: Awaited<ReturnType<typeof client.workflow.start>> | undefined;
try {
  const first = await startWorker();
  handle = await client.workflow.start('durabilityProbeWorkflow', {
    args: [workflowId],
    taskQueue,
    workflowId,
  });
  await eventually(
    () => handle!.query<string>('probeStatus'),
    (state) => state === 'WAITING',
  );
  console.info('Temporal persisted WAITING Workflow state. Killing first Worker.');
  const exited = new Promise<void>((resolveExit) => first.once('exit', () => resolveExit()));
  first.kill('SIGKILL');
  await exited;
  await startWorker();
  await eventually(
    () => handle!.query<string>('probeStatus'),
    (state) => state === 'WAITING',
  );
  await handle.signal('releaseProbe', token);
  let resultTimeout: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    handle.result(),
    new Promise<never>((_, reject) => {
      resultTimeout = setTimeout(
        () => reject(new Error('Workflow did not finish after Worker restart')),
        20_000,
      );
    }),
  ]).finally(() => clearTimeout(resultTimeout));
  if (
    !result ||
    typeof result !== 'object' ||
    !('runId' in result) ||
    !('token' in result) ||
    result.runId !== workflowId ||
    result.token !== token
  ) {
    throw new Error(`Unexpected Workflow result: ${JSON.stringify(result)}`);
  }
  console.info(`PASS: Temporal Workflow ${workflowId} survived Worker SIGKILL and resumed.`);
} finally {
  if (handle) {
    try {
      await handle.terminate('Durability probe cleanup');
    } catch {
      // A successfully completed Workflow cannot be terminated.
    }
  }
  for (const worker of workers) worker.kill('SIGKILL');
  await connection.close();
}
