import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Client, Connection } from '@temporalio/client';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { workflowIdForRun } from '../src/outbox-dispatcher';

const runId = process.env.AYRA_TEST_RUN_ID;
const cancelRunId = process.env.AYRA_TEST_CANCEL_RUN_ID;
const cancelTaskId = process.env.AYRA_TEST_CANCEL_TASK_ID;
const actorId = process.env.AYRA_TEST_ACTOR_ID;
const databaseUrl = process.env.DATABASE_URL;
if (!runId || !cancelRunId || !cancelTaskId || !actorId || !databaseUrl)
  throw new Error('M3 integration Runs, actor and database are required');
const bucket = process.env.OBJECT_STORE_BUCKET;
const endpoint = process.env.OBJECT_STORE_ENDPOINT;
const accessKeyId = process.env.MINIO_ROOT_USER;
const secretAccessKey = process.env.MINIO_ROOT_PASSWORD;
if (!bucket || !endpoint || !accessKeyId || !secretAccessKey)
  throw new Error('Local M3 object store credentials are required');
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const workflowId = workflowIdForRun(runId);
const cancelWorkflowId = workflowIdForRun(cancelRunId);
const taskQueue = `ayra-db-task-test-${randomUUID()}`;
const workerPath = fileURLToPath(new URL('./db-task-workflow-worker.ts', import.meta.url));
const workers = new Set<ChildProcessWithoutNullStreams>();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
let activeConnection: Connection | undefined;
let resultObjectKey: string | undefined;

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
      reject(new Error(`DB Task Worker did not become ready: ${output.slice(-1000)}`));
    }, 30_000);
    const receive = (data: Buffer) => {
      output += data.toString();
      if (output.includes('AYRA_DB_TASK_WORKER_READY')) {
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
      if (!output.includes('AYRA_DB_TASK_WORKER_READY'))
        reject(new Error(`DB Task Worker exited ${code}: ${output.slice(-1000)}`));
    });
  });
}

async function waitForPaused(client: Client, targetWorkflowId = workflowId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if (
        (await client.workflow.getHandle(targetWorkflowId).query<string>('taskStage')) === 'PAUSED'
      )
        return;
    } catch {
      // Workflow may not have completed its first Workflow Task yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error('DB-backed Task Workflow did not reach PAUSED');
}

async function waitForWorkflowStart(client: Client, targetWorkflowId = workflowId) {
  const handle = client.workflow.getHandle(targetWorkflowId);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await handle.describe();
      return handle;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  throw new Error('Worker loop did not dispatch the queued Task Workflow');
}

try {
  const firstWorker = await startWorker();
  activeConnection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
  });
  let client = new Client({
    connection: activeConnection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
  });
  const [mainHandle, cancelHandle] = await Promise.all([
    waitForWorkflowStart(client),
    waitForWorkflowStart(client, cancelWorkflowId),
  ]);
  await Promise.all([mainHandle.signal('pauseTask'), cancelHandle.signal('pauseTask')]);
  await waitForPaused(client);
  await waitForPaused(client, cancelWorkflowId);
  const cancelDb = await pool.connect();
  try {
    await cancelDb.query('BEGIN');
    await cancelDb.query("SELECT set_config('ayra.actor_user_id', $1, true)", [actorId]);
    const current = await cancelDb.query<{ version: string }>(
      'SELECT version FROM tasks WHERE id = $1',
      [cancelTaskId],
    );
    const version = Number(current.rows[0]?.version);
    if (!Number.isSafeInteger(version)) throw new Error('Active cancellation Task is missing');
    const canceled = await cancelDb.query<{ result_code: string; run_id: string }>(
      'SELECT * FROM ayra.cancel_task_attempt($1, $2)',
      [cancelTaskId, version],
    );
    if (canceled.rows[0]?.result_code !== 'CANCELED' || canceled.rows[0].run_id !== cancelRunId)
      throw new Error('Active Task cancellation transaction failed');
    await cancelDb.query('COMMIT');
  } finally {
    await cancelDb.query('ROLLBACK');
    cancelDb.release();
  }
  const canceledWorkflow = await cancelHandle.result();
  if (canceledWorkflow?.status !== 'CANCELED')
    throw new Error('Worker loop did not deliver active Task cancellation');

  // Close the client and kill the Worker; neither is Task's source of truth.
  await activeConnection.close();
  activeConnection = undefined;
  const exited = new Promise<void>((resolveExit) => firstWorker.once('exit', () => resolveExit()));
  firstWorker.kill('SIGKILL');
  await exited;
  await startWorker();
  activeConnection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
  });
  client = new Client({
    connection: activeConnection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
  });
  await waitForPaused(client);
  const handle = client.workflow.getHandle(workflowId);
  await handle.signal('resumeTask');
  const result = await handle.result();
  if (result?.runId !== runId || result.status !== 'COMPLETED')
    throw new Error(`DB-backed Task Workflow returned ${JSON.stringify(result)}`);
  const canonical = await pool.query<{ task_status: string; run_status: string }>(
    `SELECT t.status AS task_status, r.status AS run_status
       FROM runs r JOIN tasks t ON t.id = r.task_id
      WHERE r.id = $1`,
    [runId],
  );
  // application_role has no actor on this connection, so canonical state is
  // verified by the calling API integration test through its authorized path.
  if (canonical.rows.length !== 0)
    throw new Error('Worker test connection unexpectedly bypassed RLS');
  const artifactClient = await pool.connect();
  try {
    await artifactClient.query('BEGIN');
    await artifactClient.query("SELECT set_config('ayra.actor_user_id', $1, true)", [actorId]);
    const artifact = await artifactClient.query<{
      object_ref: string;
      provenance: { sha256: string; kind: string };
    }>(
      `SELECT object_ref, provenance FROM artifacts
        WHERE run_id = $1 AND deleted_at IS NULL`,
      [runId],
    );
    if (artifact.rows.length !== 1 || artifact.rows[0]?.provenance.kind !== 'RUN_RESULT')
      throw new Error('Task Workflow did not canonicalize exactly one result Artifact');
    const objectRef = artifact.rows[0].object_ref;
    const prefix = `s3://${bucket}/`;
    if (!objectRef.startsWith(prefix)) throw new Error('Result Artifact has wrong object store');
    resultObjectKey = objectRef.slice(prefix.length);
    await artifactClient.query('COMMIT');
    const stored = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: resultObjectKey }));
    const text = await stored.Body?.transformToString();
    if (!text?.startsWith('output: plan: understood:'))
      throw new Error('Result Artifact object content was not persisted');
  } finally {
    await artifactClient.query('ROLLBACK');
    artifactClient.release();
  }
  console.info('PASS: DB Task survived client disconnect and Worker SIGKILL, then completed.');
} finally {
  if (activeConnection) {
    const client = new Client({
      connection: activeConnection,
      namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
    });
    for (const target of [workflowId, cancelWorkflowId]) {
      try {
        await client.workflow.getHandle(target).terminate('M3 integration cleanup');
      } catch {
        // Completed Workflow cannot be terminated.
      }
    }
    await activeConnection.close();
  }
  for (const worker of workers) worker.kill('SIGKILL');
  await pool.end();
  if (resultObjectKey && process.env.AYRA_TEST_KEEP_RESULT_OBJECT !== '1')
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: resultObjectKey }));
  s3.destroy();
}
