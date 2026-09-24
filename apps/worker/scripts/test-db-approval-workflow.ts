import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Client, Connection } from '@temporalio/client';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { workflowIdForRun } from '../src/outbox-dispatcher';

loadEnvFile('.env.local');
const runId = process.env.AYRA_TEST_APPROVAL_RUN_ID;
const taskId = process.env.AYRA_TEST_APPROVAL_TASK_ID;
const ownerId = process.env.AYRA_TEST_APPROVAL_ACTOR_ID;
const workspaceId = process.env.AYRA_TEST_APPROVAL_WORKSPACE_ID;
const databaseUrl = process.env.DATABASE_URL;
const decisionKind = process.env.AYRA_TEST_APPROVAL_DECISION ?? 'APPROVED';
if (decisionKind !== 'APPROVED' && decisionKind !== 'REJECTED')
  throw new Error('Invalid Approval integration decision');
const bucket = process.env.OBJECT_STORE_BUCKET;
const endpoint = process.env.OBJECT_STORE_ENDPOINT;
const accessKeyId = process.env.MINIO_ROOT_USER;
const secretAccessKey = process.env.MINIO_ROOT_PASSWORD;
if (
  !runId ||
  !taskId ||
  !ownerId ||
  !workspaceId ||
  !databaseUrl ||
  !bucket ||
  !endpoint ||
  !accessKeyId ||
  !secretAccessKey
)
  throw new Error('DB Approval Workflow fixture is incomplete');

const taskQueue = `ayra-db-approval-test-${randomUUID()}`;
const requestKey = randomUUID();
const expiresAt = new Date(Date.now() + 120_000).toISOString();
const workflowId = workflowIdForRun(runId);
const workerPath = fileURLToPath(new URL('./db-task-workflow-worker.ts', import.meta.url));
const workers = new Set<ChildProcessWithoutNullStreams>();
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
let connection: Connection | undefined;
let resultObjectKey: string | undefined;

function startWorker(): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, ['--import', 'tsx', workerPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AYRA_TEST_TASK_QUEUE: taskQueue,
      AYRA_TEST_APPROVAL_REQUEST_KEY: requestKey,
      AYRA_TEST_APPROVAL_EXPIRES_AT: expiresAt,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  workers.add(child);
  return new Promise((resolveReady, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Approval Worker did not become ready: ${output.slice(-1000)}`));
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
        reject(new Error(`Approval Worker exited ${code}: ${output.slice(-1000)}`));
    });
  });
}

async function withActor<T>(work: (client: pg.PoolClient) => Promise<T>) {
  const database = await pool.connect();
  try {
    await database.query('BEGIN');
    await database.query("SELECT set_config('ayra.actor_user_id', $1, true)", [ownerId]);
    const result = await work(database);
    await database.query('COMMIT');
    return result;
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  } finally {
    database.release();
  }
}

async function waitForApproval(client: Client) {
  const handle = client.workflow.getHandle(workflowId);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const approval = await withActor(async (database) =>
      database.query<{ id: string; state_version: string; status: string }>(
        'SELECT id, state_version, status FROM approvals WHERE run_id = $1 AND request_key = $2',
        [runId, requestKey],
      ),
    );
    const row = approval.rows[0];
    if (row) {
      const stage = await handle.query<string>('taskStage');
      if (stage === 'WAITING_APPROVAL' && row.status === 'PENDING') return row;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error('Workflow did not enter canonical Approval wait');
}

try {
  const firstWorker = await startWorker();
  connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
  });
  const client = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
  });
  const approval = await waitForApproval(client);
  console.info('Approval Workflow reached WAITING_APPROVAL');
  const beforeRestart = await pool.query<{ state: string }>(
    'SELECT ayra.worker_approval_state($1,$2,$3) AS state',
    [runId, approval.id, approval.state_version],
  );
  if (beforeRestart.rows[0]?.state !== 'PENDING')
    throw new Error('Worker did not reconcile pending Approval from database');

  const exited = new Promise<void>((resolveExit) => firstWorker.once('exit', () => resolveExit()));
  firstWorker.kill('SIGKILL');
  await exited;
  const decision = await withActor((database) =>
    database.query<{ outcome: string }>('SELECT ayra.decide_approval($1, $2, $3) AS outcome', [
      approval.id,
      1,
      decisionKind,
    ]),
  );
  if (decision.rows[0]?.outcome !== decisionKind)
    throw new Error('Canonical Approval decision was rejected');
  await startWorker();
  console.info(`Approval Workflow resumed Worker after ${decisionKind}`);
  let completed = false;
  let completionTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.workflow.getHandle(workflowId).result(),
      new Promise<never>((_resolve, reject) => {
        completionTimeout = setTimeout(
          () => reject(new Error('Approval Workflow recovery timed out')),
          45_000,
        );
      }),
    ]);
    completed = result?.status === 'COMPLETED' && result.runId === runId;
  } catch (error) {
    if (error instanceof Error && error.message === 'Approval Workflow recovery timed out')
      throw error;
    if (decisionKind !== 'REJECTED')
      throw new Error('Approved Workflow failed after recovery', { cause: error });
  } finally {
    clearTimeout(completionTimeout);
  }
  if (completed !== (decisionKind === 'APPROVED'))
    throw new Error('Approval Workflow ignored the canonical decision');
  const canonical = await withActor(async (database) => {
    const state = await database.query<{
      task_status: string;
      run_status: string;
      approval_status: string;
      object_ref: string | null;
    }>(
      `SELECT t.status AS task_status, r.status AS run_status,
              a.status AS approval_status, ar.object_ref
         FROM tasks t JOIN runs r ON r.id = t.current_run_id
         JOIN approvals a ON a.run_id = r.id AND a.id = $2
         LEFT JOIN artifacts ar ON ar.run_id = r.id AND ar.deleted_at IS NULL
        WHERE t.id = $1`,
      [taskId, approval.id],
    );
    return state.rows[0];
  });
  if (decisionKind === 'APPROVED') {
    if (
      canonical?.task_status !== 'COMPLETED' ||
      canonical.run_status !== 'COMPLETED' ||
      canonical.approval_status !== 'CONSUMED' ||
      !canonical.object_ref
    )
      throw new Error('Approval Workflow did not commit canonical result');
    const prefix = `s3://${bucket}/`;
    if (!canonical.object_ref.startsWith(prefix))
      throw new Error('Result Artifact has wrong bucket');
    resultObjectKey = canonical.object_ref.slice(prefix.length);
    console.info(
      'PASS: Approval Workflow survived Worker SIGKILL and completed after DB decision.',
    );
  } else {
    if (
      canonical?.task_status !== 'FAILED' ||
      canonical.run_status !== 'FAILED' ||
      canonical.approval_status !== 'REJECTED' ||
      canonical.object_ref !== null
    )
      throw new Error('Rejected Approval caused execution or left a result Artifact');
    console.info(
      'PASS: Rejected Approval failed the Task without executing or creating an Artifact.',
    );
  }
} finally {
  if (connection) {
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
    });
    try {
      await client.workflow.getHandle(workflowId).terminate('Approval integration cleanup');
    } catch {
      // Completed Workflows cannot be terminated.
    }
    await connection.close();
  }
  for (const worker of workers) worker.kill('SIGKILL');
  await pool.end();
  if (resultObjectKey)
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: resultObjectKey }));
  s3.destroy();
}
