import { S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createTaskActivities } from '../src/task-activities';
import { createApprovalRequester } from '../src/approval-requester';
import { createApprovalConsumer } from '../src/approval-consumer';
import { createResultArtifactCanonicalizer } from '../src/result-artifact';
import { runTaskExecutionProcess } from '../src/task-execution-process';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for M3 integration Worker');
const bucket = process.env.OBJECT_STORE_BUCKET;
const endpoint = process.env.OBJECT_STORE_ENDPOINT;
const accessKeyId = process.env.MINIO_ROOT_USER;
const secretAccessKey = process.env.MINIO_ROOT_PASSWORD;
if (!bucket || !endpoint || !accessKeyId || !secretAccessKey)
  throw new Error('Local M3 object store credentials are required');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const approvalRunId = process.env.AYRA_TEST_APPROVAL_RUN_ID;
const approvalActorId = process.env.AYRA_TEST_APPROVAL_ACTOR_ID;
const approvalRequestKey = process.env.AYRA_TEST_APPROVAL_REQUEST_KEY;
const approvalHash = 'f'.repeat(64);
const requestApproval = createApprovalRequester(pool);
const approvalConsumer = createApprovalConsumer(pool);
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const shutdown = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => shutdown.abort());
try {
  const canonicalize = createResultArtifactCanonicalizer(pool, s3, bucket);
  const activities = createTaskActivities(
    pool,
    {
      async understand(_runId, goal) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 3000));
        return `understood: ${goal}`;
      },
      async plan(_runId, understanding) {
        return `plan: ${understanding}`;
      },
      async execute(runId, plan, approvedRequest) {
        if (runId === approvalRunId) {
          if (!approvalActorId || !approvalRequestKey)
            throw new Error('Approval integration fixture is incomplete');
          if (!approvedRequest) {
            const receipt = await requestApproval({
              runId,
              targetUserId: approvalActorId,
              action: 'test.output@1',
              resourceRef: 'test-result',
              argumentsHash: approvalHash,
              expiresAt: new Date(process.env.AYRA_TEST_APPROVAL_EXPIRES_AT ?? ''),
              requestKey: approvalRequestKey,
            });
            return {
              kind: 'APPROVAL_REQUIRED',
              approvalId: receipt.approvalId,
              stateVersion: receipt.stateVersion,
            };
          }
          const consumed = await approvalConsumer.consume({
            approvalId: approvedRequest.approvalId,
            workspaceId: process.env.AYRA_TEST_APPROVAL_WORKSPACE_ID ?? '',
            runOwnerId: approvalActorId,
            taskId: process.env.AYRA_TEST_APPROVAL_TASK_ID ?? '',
            runId,
            action: 'test.output@1',
            resourceRef: 'test-result',
            argumentsHash: approvalHash,
            stateVersion: approvedRequest.stateVersion,
          });
          if (!consumed) throw new Error('Canonical Approval was not consumed');
        }
        return `output: ${plan}`;
      },
      async verify(_runId, output) {
        return output.startsWith('output: plan: understood:');
      },
    },
    async (runId, output) => {
      await canonicalize(runId, output);
      await canonicalize(runId, output);
    },
  );
  await runTaskExecutionProcess({
    pool,
    activities,
    address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'ayra-development',
    taskQueue: process.env.AYRA_TEST_TASK_QUEUE ?? 'ayra-db-task-test',
    workflowsPath: fileURLToPath(
      new URL(
        process.env.AYRA_TEST_BUNDLED_WORKFLOW === '1'
          ? '../dist/task.workflow.js'
          : '../src/task.workflow.ts',
        import.meta.url,
      ),
    ),
    signal: shutdown.signal,
    pollIntervalMs: 100,
    onReady: () => console.info('AYRA_DB_TASK_WORKER_READY'),
  });
} finally {
  await pool.end();
  s3.destroy();
}
