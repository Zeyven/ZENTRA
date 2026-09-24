import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createClerkIdentityProvider } from '@ayra/auth';
import type { ApprovalId, ArtifactId, RunId, TaskId, UserId, WorkspaceId } from '@ayra/domain';
import { createApp } from '../src/app';
import { createArtifactMetadata, softDeleteArtifactMetadata } from '../src/artifacts';
import { createRunAttempt, readRunAttempt } from '../src/runs';
import { createApprovalRequest, readApprovalRequest } from '../src/approvals';
import { dispatchTaskStartBatch, workflowIdForRun } from '../../worker/src/outbox-dispatcher';

loadEnvFile('.env.local');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const nonce = randomUUID().replaceAll('-', '');
const users: string[] = [];
const workspaces: string[] = [];
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const identity = createClerkIdentityProvider({
  jwtKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  authorizedParties: ['http://localhost:3000'],
});
const accessKeyId = process.env.MINIO_ROOT_USER;
const secretAccessKey = process.env.MINIO_ROOT_PASSWORD;
const endpoint = process.env.OBJECT_STORE_ENDPOINT;
const bucket = process.env.OBJECT_STORE_BUCKET;
if (!accessKeyId || !secretAccessKey || !endpoint || !bucket)
  throw new Error('Local object store configuration is required');
const s3 = new S3Client({
  region: 'us-east-1',
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const now = Math.floor(Date.now() / 1000);
function signedToken(label: string) {
  const account = label === 'integration-alice-2' ? 'integration-alice' : label;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: `${nonce}-${account}`,
      sid: `test-${nonce}-${label}`,
      iss: 'https://test.clerk.accounts.dev',
      azp: 'http://localhost:3000',
      iat: now,
      nbf: now - 5,
      exp: now + 300,
    }),
  ).toString('base64url');
  const message = `${header}.${payload}`;
  return `${message}.${sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')}`;
}
const tokens = Object.fromEntries(
  ['integration-alice', 'integration-alice-2', 'integration-bob'].map((label) => [
    label,
    signedToken(label),
  ]),
);
const app = await createApp({
  identity,
  pool,
  taskExecutionEnabled: true,
  artifactAccess: { client: s3, bucket },
});
let cleanupFailed = false;
let testResultKey: string | undefined;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function expectUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Expected AYRA UUID');
  return value;
}
async function call(
  token: string,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
  extraHeaders: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${tokens[token] ?? token}`, ...extraHeaders },
    ...(payload ? { payload } : {}),
  });
}
function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function checkRetention(type: 'Task' | 'Resource' | 'Artifact', id: string) {
  check(
    migrationSql(
      `SELECT count(*) FROM retention_requests
       WHERE aggregate_type = '${type}' AND aggregate_id = '${expectUuid(id)}'
         AND status = 'PENDING_POLICY' AND scheduled_for IS NULL;`,
    ) === '1',
    `${type} soft delete did not create exactly one pending retention handoff`,
  );
}
function migrationSql(statement: string) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'ayra-local-postgres-1',
      'psql',
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'migration_role',
      '-d',
      'ayra',
    ],
    { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
  );
  if (result.status !== 0) throw new Error('Integration fixture SQL failed');
  return result.stdout.trim();
}
try {
  const unauthenticated = await app.inject({ method: 'GET', url: '/v1/account' });
  check(unauthenticated.statusCode === 401, 'Account accepted an unauthenticated request');
  check(
    (await call('invalid', 'GET', '/v1/account')).statusCode === 401,
    'Invalid session was accepted',
  );
  check(
    (await call('integration-alice', 'POST', '/v1/workspaces', { name: '   ' })).statusCode === 400,
    'Whitespace workspace name was accepted',
  );

  for (const token of ['integration-alice', 'integration-bob']) {
    const account = await call(token, 'GET', '/v1/account');
    check(account.statusCode === 200, 'Verified session did not resolve AYRA account');
    const body = account.json();
    users.push(expectUuid(body.id));
    check(!JSON.stringify(body).includes(nonce), 'Provider subject leaked from Domain API');
    const workspace = await call(token, 'POST', '/v1/workspaces', { name: `${token} workspace` });
    check(workspace.statusCode === 201, 'Workspace creation failed');
    workspaces.push(expectUuid(workspace.json().id));
  }
  const [alpha, beta] = workspaces;
  if (!alpha || !beta) throw new Error('Missing test workspaces');
  check(
    (await call('integration-alice', 'GET', `/v1/workspaces/${alpha}`)).statusCode === 200,
    'Owner cannot read workspace',
  );
  check(
    (await call('integration-alice', 'GET', `/v1/workspaces/${beta}`)).statusCode === 404,
    'Alice read Bob workspace',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/workspaces/${alpha}`)).statusCode === 404,
    'Bob read Alice workspace',
  );
  const list = await call('integration-alice', 'GET', '/v1/workspaces');
  check(list.statusCode === 200, 'Workspace list failed');
  const ids = (list.json().workspaces as { id: string }[]).map((row) => row.id);
  check(ids.includes(alpha) && !ids.includes(beta), 'Workspace list crossed tenant boundary');
  const projectInput = {
    workspaceId: alpha,
    name: 'Integration Project',
    description: 'Task context',
  };
  check(
    (await call('integration-alice', 'POST', '/v1/projects', projectInput)).statusCode === 400,
    'Project accepted missing idempotency key',
  );
  const projectKey = randomUUID();
  const projectResponse = await call('integration-alice', 'POST', '/v1/projects', projectInput, {
    'idempotency-key': projectKey,
  });
  check(projectResponse.statusCode === 201, 'Project creation failed');
  const projectId = expectUuid(projectResponse.json().id);
  const replay = await call('integration-alice', 'POST', '/v1/projects', projectInput, {
    'idempotency-key': projectKey,
  });
  check(
    replay.statusCode === 201 && replay.json().id === projectId,
    'Project idempotency replay changed result',
  );
  check(
    (
      await call(
        'integration-alice',
        'POST',
        '/v1/projects',
        { ...projectInput, name: 'Different' },
        {
          'idempotency-key': projectKey,
        },
      )
    ).statusCode === 409,
    'Changed payload reused idempotency key',
  );
  check(
    migrationSql(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${projectId}' AND event_type = 'project.created.v1';`,
    ) === '1',
    'Idempotency replay duplicated outbox',
  );
  check(
    migrationSql(
      `SELECT count(*) FROM audit_events WHERE aggregate_id = '${projectId}' AND action = 'project.created';`,
    ) === '1',
    'Idempotency replay duplicated audit',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/projects/${projectId}`)).statusCode === 404,
    'Bob read Alice Project',
  );
  check(
    (
      await call(
        'integration-bob',
        'POST',
        '/v1/projects',
        { workspaceId: alpha, name: 'Denied' },
        { 'idempotency-key': randomUUID() },
      )
    ).statusCode === 404,
    'Bob created Project in Alice Workspace',
  );
  const projectList = await call('integration-alice', 'GET', `/v1/projects?workspaceId=${alpha}`);
  check(
    projectList.statusCode === 200 && projectList.json().projects[0]?.id === projectId,
    'Project list missed canonical Project',
  );
  const updated = await call('integration-alice', 'PATCH', `/v1/projects/${projectId}`, {
    version: 1,
    name: 'Updated Project',
  });
  check(
    updated.statusCode === 200 && updated.json().version === 2,
    'Optimistic Project update failed',
  );
  check(
    (
      await call('integration-alice', 'PATCH', `/v1/projects/${projectId}`, {
        version: 1,
        name: 'Stale',
      })
    ).statusCode === 409,
    'Stale Project update succeeded',
  );
  const taskInput = {
    workspaceId: alpha,
    projectId,
    title: 'Draft analysis',
    goal: 'Produce a reviewable result',
    type: 'WORK',
  };
  check(
    (await call('integration-alice', 'POST', '/v1/tasks', taskInput)).statusCode === 400,
    'Task accepted missing idempotency key',
  );
  const taskKey = randomUUID();
  const taskResponse = await call('integration-alice', 'POST', '/v1/tasks', taskInput, {
    'idempotency-key': taskKey,
  });
  check(
    taskResponse.statusCode === 201 &&
      taskResponse.json().status === 'DRAFT' &&
      taskResponse.json().currentRunId === null,
    'Task draft creation failed or invented a Run',
  );
  const taskId = expectUuid(taskResponse.json().id);
  const runClient = await pool.connect();
  let runId: string;
  try {
    await runClient.query('BEGIN');
    await runClient.query("SELECT set_config('ayra.actor_user_id', $1, true)", [
      expectUuid(users[0]),
    ]);
    const runInput = {
      workspaceId: alpha as WorkspaceId,
      taskId: taskId as TaskId,
      attempt: 1,
      idempotencyKey: randomUUID(),
    };
    const firstRun = await createRunAttempt(runClient, expectUuid(users[0]) as UserId, runInput);
    runId = expectUuid(firstRun.id);
    const replayedRun = await createRunAttempt(runClient, expectUuid(users[0]) as UserId, runInput);
    check(
      replayedRun.id === runId && replayedRun.status === 'PENDING',
      'Run attempt replay changed identity or state',
    );
    check(
      (await readRunAttempt(runClient, expectUuid(users[0]) as UserId, runId as RunId))?.id ===
        runId,
      'Owner could not read Run attempt',
    );
    await runClient.query('COMMIT');
  } catch (error) {
    await runClient.query('ROLLBACK');
    throw error;
  } finally {
    runClient.release();
  }
  const taskAfterRun = await call('integration-alice', 'GET', `/v1/tasks/${taskId}`);
  check(
    taskAfterRun.json().status === 'DRAFT' && taskAfterRun.json().currentRunId === null,
    'Run record falsely advanced Task canonical state',
  );
  check(
    migrationSql(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${runId}' AND event_type = 'run.created.v1';`,
    ) === '1',
    'Run idempotency replay duplicated outbox',
  );
  const rolledBackRun = expectUuid(
    migrationSql(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${expectUuid(users[0])}';
       INSERT INTO runs(workspace_id, task_id, attempt, status, created_by)
       VALUES ('${alpha}', '${taskId}', 2, 'PENDING', '${expectUuid(users[0])}') RETURNING id;
       ROLLBACK;`,
    ),
  );
  check(
    migrationSql(`SELECT count(*) FROM runs WHERE id = '${rolledBackRun}';`) === '0' &&
      migrationSql(`SELECT count(*) FROM audit_events WHERE aggregate_id = '${rolledBackRun}';`) ===
        '0' &&
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${rolledBackRun}';`,
      ) === '0',
    'Rolled-back Run left entity or event behind',
  );
  const foreignRunClient = await pool.connect();
  try {
    await foreignRunClient.query('BEGIN');
    await foreignRunClient.query("SELECT set_config('ayra.actor_user_id', $1, true)", [
      expectUuid(users[1]),
    ]);
    check(
      (await readRunAttempt(foreignRunClient, expectUuid(users[1]) as UserId, runId as RunId)) ===
        null,
      'Bob read Alice Run without membership',
    );
  } finally {
    await foreignRunClient.query('ROLLBACK');
    foreignRunClient.release();
  }
  const approvalInput = {
    workspaceId: alpha as WorkspaceId,
    userId: expectUuid(users[0]) as UserId,
    taskId: taskId as TaskId,
    runId: runId as RunId,
    action: 'review.external.action',
    resourceRef: 'test-resource',
    argumentsHash: createHash('sha256').update('test-arguments').digest('hex'),
    stateVersion: 1,
    expiresAt: new Date(Date.now() + 120000),
    idempotencyKey: randomUUID(),
  };
  const approvalClient = await pool.connect();
  let approvalId: string;
  try {
    await approvalClient.query('BEGIN');
    await approvalClient.query("SELECT set_config('ayra.actor_user_id', $1, true)", [
      expectUuid(users[0]),
    ]);
    const requested = await createApprovalRequest(
      approvalClient,
      expectUuid(users[0]) as UserId,
      approvalInput,
    );
    approvalId = expectUuid(requested.id);
    const replay = await createApprovalRequest(
      approvalClient,
      expectUuid(users[0]) as UserId,
      approvalInput,
    );
    check(
      replay.id === approvalId && replay.status === 'PENDING',
      'Approval replay changed identity or state',
    );
    check(
      (
        await readApprovalRequest(
          approvalClient,
          expectUuid(users[0]) as UserId,
          approvalId as ApprovalId,
        )
      )?.id === approvalId,
      'Approval target could not read request',
    );
    await approvalClient.query('COMMIT');
  } catch (error) {
    await approvalClient.query('ROLLBACK');
    throw error;
  } finally {
    approvalClient.release();
  }
  check(
    migrationSql(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${approvalId}' AND event_type = 'approval.requested.v1';`,
    ) === '1',
    'Approval request replay duplicated outbox',
  );
  check(
    migrationSql(`SELECT status FROM approvals WHERE id = '${approvalId}';`) === 'PENDING',
    'Approval was decided without a decision path',
  );
  const deniedApprovalKey = randomUUID();
  const deniedApprovalClient = await pool.connect();
  let deniedNonmemberTarget = false;
  try {
    await deniedApprovalClient.query('BEGIN');
    await deniedApprovalClient.query("SELECT set_config('ayra.actor_user_id', $1, true)", [
      expectUuid(users[0]),
    ]);
    try {
      await createApprovalRequest(deniedApprovalClient, expectUuid(users[0]) as UserId, {
        ...approvalInput,
        userId: expectUuid(users[1]) as UserId,
        idempotencyKey: deniedApprovalKey,
      });
    } catch {
      deniedNonmemberTarget = true;
    }
  } finally {
    await deniedApprovalClient.query('ROLLBACK');
    deniedApprovalClient.release();
  }
  check(deniedNonmemberTarget, 'Approval targeted a user outside the Workspace');
  check(
    migrationSql(
      `SELECT count(*) FROM idempotency_records WHERE workspace_id = '${alpha}' AND key = '${deniedApprovalKey}';`,
    ) === '0',
    'Denied Approval left idempotency reservation',
  );
  check(
    (
      await call('integration-alice', 'POST', `/v1/approvals/${approvalId}/decision`, {
        decision: 'APPROVE',
      })
    ).statusCode === 404,
    'Approval decision route was exposed before tool authorization exists',
  );
  const rolledBackApproval = expectUuid(
    migrationSql(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${expectUuid(users[0])}';
       INSERT INTO approvals(
         workspace_id, user_id, task_id, run_id, action, resource_ref,
         arguments_hash, state_version, expires_at
       ) VALUES (
         '${alpha}', '${expectUuid(users[0])}', '${taskId}', '${runId}',
         'review.rollback', 'test-resource', '${approvalInput.argumentsHash}',
         1, now() + interval '2 minutes'
       ) RETURNING id; ROLLBACK;`,
    ),
  );
  check(
    migrationSql(`SELECT count(*) FROM approvals WHERE id = '${rolledBackApproval}';`) === '0' &&
      migrationSql(
        `SELECT count(*) FROM audit_events WHERE aggregate_id = '${rolledBackApproval}';`,
      ) === '0' &&
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${rolledBackApproval}';`,
      ) === '0',
    'Rolled-back Approval left entity or event behind',
  );
  const artifactKey = randomUUID();
  const artifactInput = {
    workspaceId: alpha as WorkspaceId,
    taskId: taskId as TaskId,
    runId,
    title: 'Generated report metadata',
    objectRef: 'test-pending-object',
    provenance: { origin: 'integration-test' },
    idempotencyKey: artifactKey,
  };
  const artifactClient = await pool.connect();
  let artifactId: string;
  try {
    await artifactClient.query('BEGIN');
    await artifactClient.query("SELECT set_config('ayra.actor_user_id', $1, true)", [
      expectUuid(users[0]),
    ]);
    const created = await createArtifactMetadata(
      artifactClient,
      expectUuid(users[0]) as UserId,
      artifactInput,
    );
    artifactId = expectUuid(created.id);
    const repeated = await createArtifactMetadata(
      artifactClient,
      expectUuid(users[0]) as UserId,
      artifactInput,
    );
    check(repeated.id === artifactId, 'Artifact internal creation replay changed identity');
    await artifactClient.query('COMMIT');
  } catch (error) {
    await artifactClient.query('ROLLBACK');
    throw error;
  } finally {
    artifactClient.release();
  }
  const artifactRead = await call('integration-alice', 'GET', `/v1/artifacts/${artifactId}`);
  check(
    artifactRead.statusCode === 200 &&
      artifactRead.json().taskId === taskId &&
      artifactRead.json().runId === runId &&
      !JSON.stringify(artifactRead.json()).includes('test-pending-object'),
    'Artifact metadata read failed or exposed object storage reference',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/artifacts/${artifactId}`)).statusCode === 404,
    'Bob read Alice Artifact',
  );
  check(
    (
      await call('integration-alice', 'POST', '/v1/artifacts', {
        ...artifactInput,
      })
    ).statusCode === 404,
    'Artifact public create route unexpectedly exists',
  );
  check(
    migrationSql(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${artifactId}' AND event_type = 'artifact.created.v1';`,
    ) === '1',
    'Artifact idempotency replay duplicated outbox',
  );
  const rollbackArtifact = expectUuid(
    migrationSql(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${expectUuid(users[0])}';
       INSERT INTO artifacts(workspace_id, task_id, title, object_ref, created_by)
       VALUES ('${alpha}', '${taskId}', 'Rollback output', 'test-rollback',
         '${expectUuid(users[0])}') RETURNING id;
       ROLLBACK;`,
    ),
  );
  check(
    migrationSql(`SELECT count(*) FROM artifacts WHERE id = '${rollbackArtifact}';`) === '0' &&
      migrationSql(
        `SELECT count(*) FROM audit_events WHERE aggregate_id = '${rollbackArtifact}';`,
      ) === '0' &&
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${rollbackArtifact}';`,
      ) === '0',
    'Rolled-back Artifact left entity or event behind',
  );
  check(
    (
      await call('integration-alice', 'POST', '/v1/tasks', taskInput, {
        'idempotency-key': taskKey,
      })
    ).json().id === taskId,
    'Task idempotency replay changed identity',
  );
  check(
    (
      await call(
        'integration-alice',
        'POST',
        '/v1/tasks',
        { ...taskInput, goal: 'Different' },
        { 'idempotency-key': taskKey },
      )
    ).statusCode === 409,
    'Task accepted reused key with changed goal',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/tasks/${taskId}`)).statusCode === 404,
    'Bob read Alice Task',
  );
  check(
    (
      await call(
        'integration-alice',
        'GET',
        `/v1/tasks?workspaceId=${alpha}&projectId=${projectId}`,
      )
    ).json().tasks[0]?.id === taskId,
    'Task list missed draft',
  );
  const taskUpdated = await call('integration-alice', 'PATCH', `/v1/tasks/${taskId}`, {
    version: 1,
    title: 'Updated draft',
  });
  check(
    taskUpdated.statusCode === 200 && taskUpdated.json().version === 2,
    'Task optimistic update failed',
  );
  const firstTaskEvents = await call(
    'integration-alice',
    'GET',
    `/v1/tasks/${taskId}/events?limit=1`,
  );
  check(
    firstTaskEvents.statusCode === 200 &&
      firstTaskEvents.json().events.length === 1 &&
      firstTaskEvents.json().events[0].type === 'task.created.v1' &&
      firstTaskEvents.json().nextAfterVersion === 1,
    'Task event feed did not return its first canonical version',
  );
  const resumedTaskEvents = await call(
    'integration-alice',
    'GET',
    `/v1/tasks/${taskId}/events?afterVersion=1`,
  );
  check(
    resumedTaskEvents.statusCode === 200 &&
      resumedTaskEvents.json().events.length === 1 &&
      resumedTaskEvents.json().events[0].type === 'task.updated.v1' &&
      resumedTaskEvents.json().nextAfterVersion === 2,
    'Task event feed lost a version after reconnect',
  );
  check(
    (await call('integration-alice', 'GET', `/v1/tasks/${taskId}/events?afterVersion=2`)).json()
      .events.length === 0,
    'Task event feed duplicated an already-seen version',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/tasks/${taskId}/events`)).statusCode === 404,
    'Cross-tenant Task events were exposed',
  );
  const listenUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  async function receiveSseEvent(afterVersion: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${listenUrl}/v1/tasks/${taskId}/events/stream`, {
        headers: {
          authorization: `Bearer ${tokens['integration-alice']}`,
          'last-event-id': String(afterVersion),
        },
        signal: controller.signal,
      });
      check(response.status === 200, 'Task SSE connection was rejected');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Task SSE response has no body');
      let received = '';
      while (!received.includes('id: 2\n')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Task SSE closed before the expected event');
        received += new TextDecoder().decode(chunk.value);
      }
      check(
        received.includes('event: task.updated.v1\n'),
        'Task SSE emitted the wrong canonical event',
      );
    } finally {
      controller.abort();
      clearTimeout(timeout);
    }
  }
  await receiveSseEvent(1);
  await receiveSseEvent(1);
  check(
    migrationSql("SELECT has_table_privilege('application_role', 'outbox_events', 'SELECT');") ===
      'f',
    'Application role received direct outbox read access',
  );
  check(
    (
      await call('integration-alice', 'PATCH', `/v1/tasks/${taskId}`, {
        version: 1,
        title: 'Stale',
      })
    ).statusCode === 409,
    'Stale Task update succeeded',
  );
  const bobId = expectUuid(users[1]);
  migrationSql(
    `INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES ('${alpha}','${bobId}','MEMBER','ACTIVE');`,
  );
  check(
    (await call('integration-bob', 'GET', `/v1/projects/${projectId}`)).statusCode === 200,
    'Shared Project was not readable',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/tasks/${taskId}`)).statusCode === 200,
    'Shared Task was not readable',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/tasks/${taskId}/events`)).json().events.length === 2,
    'Active Workspace member could not read Task events',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/artifacts/${artifactId}`)).statusCode === 200,
    'Shared Artifact metadata was not readable',
  );
  const otherMemberApprovalClient = await pool.connect();
  try {
    await otherMemberApprovalClient.query('BEGIN');
    await otherMemberApprovalClient.query("SELECT set_config('ayra.actor_user_id', $1, true)", [
      bobId,
    ]);
    check(
      (await readApprovalRequest(
        otherMemberApprovalClient,
        bobId as UserId,
        approvalId as ApprovalId,
      )) === null,
      'Non-target MEMBER read Approval',
    );
  } finally {
    await otherMemberApprovalClient.query('ROLLBACK');
    otherMemberApprovalClient.release();
  }
  check(
    (await call('integration-bob', 'PATCH', `/v1/tasks/${taskId}`, { version: 2, title: 'Denied' }))
      .statusCode === 403,
    'MEMBER modified Task',
  );
  check(
    (
      await call(
        'integration-bob',
        'POST',
        '/v1/tasks',
        { ...taskInput, title: 'Denied' },
        { 'idempotency-key': randomUUID() },
      )
    ).statusCode === 403,
    'MEMBER created Task',
  );
  check(
    (
      await call('integration-bob', 'PATCH', `/v1/projects/${projectId}`, {
        version: 2,
        name: 'Denied',
      })
    ).statusCode === 403,
    'MEMBER modified Project',
  );
  check(
    (
      await call('integration-bob', 'POST', `/v1/projects/${projectId}/archive`, {
        version: 2,
      })
    ).statusCode === 403,
    'MEMBER archived Project',
  );
  const suspendedStreamController = new AbortController();
  const suspendedStream = await fetch(
    `${listenUrl}/v1/tasks/${taskId}/events/stream?afterVersion=2`,
    {
      headers: { authorization: `Bearer ${tokens['integration-bob']}` },
      signal: suspendedStreamController.signal,
    },
  );
  check(suspendedStream.status === 200, 'Active member could not open Task SSE');
  const suspendedReader = suspendedStream.body?.getReader();
  if (!suspendedReader) throw new Error('Member Task SSE response has no body');
  await suspendedReader.read();
  migrationSql(
    `UPDATE workspace_memberships SET status = 'SUSPENDED' WHERE workspace_id = '${alpha}' AND user_id = '${bobId}';`,
  );
  let streamCloseTimeout: NodeJS.Timeout | undefined;
  try {
    const closedAfterSuspension = await Promise.race([
      suspendedReader.read(),
      new Promise<never>((_, reject) => {
        streamCloseTimeout = setTimeout(
          () => reject(new Error('Task SSE stayed open after membership suspension')),
          4000,
        );
      }),
    ]);
    check(closedAfterSuspension.done === true, 'Task SSE continued after membership suspension');
  } finally {
    clearTimeout(streamCloseTimeout);
    suspendedStreamController.abort();
  }
  check(
    (await call('integration-bob', 'GET', `/v1/projects/${projectId}`)).statusCode === 404,
    'Suspended member retained Project access',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/tasks/${taskId}`)).statusCode === 404,
    'Suspended member retained Task access',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/tasks/${taskId}/events`)).statusCode === 404,
    'Suspended member retained Task event access',
  );
  const artifactDeleteClient = await pool.connect();
  try {
    await artifactDeleteClient.query('BEGIN');
    await artifactDeleteClient.query("SELECT set_config('ayra.actor_user_id', $1, true)", [
      expectUuid(users[0]),
    ]);
    const deleted = await softDeleteArtifactMetadata(
      artifactDeleteClient,
      expectUuid(users[0]) as UserId,
      artifactId as ArtifactId,
      1,
    );
    check(deleted.version === 2 && Boolean(deleted.deletedAt), 'Artifact soft delete failed');
    const replay = await createArtifactMetadata(
      artifactDeleteClient,
      expectUuid(users[0]) as UserId,
      artifactInput,
    );
    check(
      replay.id === artifactId && Boolean(replay.deletedAt),
      'Deleted Artifact replay lost canonical result',
    );
    await artifactDeleteClient.query('COMMIT');
  } catch (error) {
    await artifactDeleteClient.query('ROLLBACK');
    throw error;
  } finally {
    artifactDeleteClient.release();
  }
  check(
    (await call('integration-alice', 'GET', `/v1/artifacts/${artifactId}`)).statusCode === 404,
    'Soft-deleted Artifact remained visible',
  );
  checkRetention('Artifact', artifactId);
  for (const eventType of ['artifact.created.v1', 'artifact.deleted.v1']) {
    check(
      migrationSql(
        `SELECT count(*) FROM audit_events WHERE aggregate_id = '${artifactId}' AND action = '${eventType}';`,
      ) === '1' &&
        migrationSql(
          `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${artifactId}' AND event_type = '${eventType}';`,
        ) === '1',
      `Artifact ${eventType} event missing or duplicated`,
    );
  }
  const secondSession = await call('integration-alice-2', 'GET', '/v1/account');
  check(
    secondSession.statusCode === 200 && secondSession.json().id === users[0],
    'Second session did not resolve same AYRA account',
  );
  const sessions = await call('integration-alice', 'GET', '/v1/account/sessions');
  check(
    sessions.statusCode === 200 && sessions.json().sessions.length === 2,
    'Active sessions not listed',
  );
  const current = (sessions.json().sessions as { id: string; current: boolean }[]).find(
    (row) => row.current,
  );
  const currentSessionId = expectUuid(current?.id);
  check(!JSON.stringify(sessions.json()).includes('session_hash'), 'Provider session hash leaked');
  check(
    (await call('integration-bob', 'POST', `/v1/account/sessions/${currentSessionId}/revoke`))
      .statusCode === 404,
    'Bob revoked Alice session',
  );
  check(
    (await call('integration-alice', 'POST', '/v1/account/sessions/revoke-others')).json()
      .revoked === 1,
    'Other session not revoked',
  );
  check(
    (await call('integration-alice-2', 'GET', '/v1/account')).statusCode === 401,
    'Revoked session retained access',
  );
  check(
    (await call('integration-alice', 'GET', '/v1/account')).statusCode === 200,
    'Current session was revoked',
  );
  check(
    (await call('integration-bob', 'GET', '/v1/account')).statusCode === 200,
    'Another account session was affected',
  );
  check(
    (await call('integration-alice', 'POST', `/v1/tasks/${taskId}/delete`, { version: 2 })).json()
      .deleted === true,
    'Task soft delete failed',
  );
  check(
    (await call('integration-alice', 'GET', `/v1/tasks/${taskId}`)).statusCode === 404,
    'Soft-deleted Task remained visible',
  );
  checkRetention('Task', taskId);
  const deletedReplay = await call('integration-alice', 'POST', '/v1/tasks', taskInput, {
    'idempotency-key': taskKey,
  });
  check(
    deletedReplay.statusCode === 201 &&
      deletedReplay.json().id === taskId &&
      deletedReplay.json().deletedAt,
    'Deleted Task create replay lost canonical result',
  );
  for (const eventType of ['task.created.v1', 'task.updated.v1', 'task.deleted.v1']) {
    check(
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${taskId}' AND event_type = '${eventType}';`,
      ) === '1',
      `Task ${eventType} outbox missing or duplicated`,
    );
  }
  const archived = await call('integration-alice', 'POST', `/v1/projects/${projectId}/archive`, {
    version: 2,
  });
  check(
    archived.statusCode === 200 && archived.json().version === 3 && archived.json().archivedAt,
    'Project archive failed',
  );
  check(
    (await call('integration-alice', 'GET', `/v1/projects/${projectId}`)).statusCode === 404,
    'Archived Project remained in active detail',
  );
  check(
    (await call('integration-alice', 'GET', `/v1/projects?workspaceId=${alpha}`)).json().projects
      .length === 0,
    'Archived Project remained in active list',
  );
  check(
    (
      await call('integration-alice', 'GET', `/v1/projects?workspaceId=${alpha}&archived=true`)
    ).json().projects[0]?.id === projectId,
    'Archived Project missing from archive list',
  );
  check(
    (
      await call(
        'integration-alice',
        'POST',
        '/v1/tasks',
        { ...taskInput, title: 'Too late' },
        {
          'idempotency-key': randomUUID(),
        },
      )
    ).statusCode === 404,
    'Task was created under archived Project',
  );
  check(
    (
      await call('integration-alice', 'POST', '/v1/tasks', taskInput, {
        'idempotency-key': taskKey,
      })
    ).json().id === taskId,
    'Task replay failed after linked Project archive',
  );
  check(
    (
      await call('integration-alice', 'POST', `/v1/projects/${projectId}/archive`, {
        version: 3,
      })
    ).statusCode === 409,
    'Project archive repeated without state transition',
  );
  check(
    (
      await call('integration-alice', 'POST', `/v1/projects/${projectId}/restore`, {
        version: 2,
      })
    ).statusCode === 409,
    'Stale Project restore succeeded',
  );
  const restored = await call('integration-alice', 'POST', `/v1/projects/${projectId}/restore`, {
    version: 3,
  });
  check(
    restored.statusCode === 200 &&
      restored.json().version === 4 &&
      restored.json().archivedAt === null,
    'Project restore failed',
  );
  for (const eventType of ['project.archived.v1', 'project.restored.v1']) {
    check(
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${projectId}' AND event_type = '${eventType}';`,
      ) === '1',
      `Project ${eventType} outbox missing or duplicated`,
    );
    check(
      migrationSql(
        `SELECT count(*) FROM audit_events WHERE aggregate_id = '${projectId}' AND action = '${eventType}';`,
      ) === '1',
      `Project ${eventType} audit missing or duplicated`,
    );
  }
  const conversationInput = { workspaceId: alpha, projectId, title: 'Research discussion' };
  const rollbackConversation = expectUuid(
    migrationSql(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${expectUuid(users[0])}';
       INSERT INTO conversations(workspace_id, project_id, title, created_by)
       VALUES ('${alpha}', '${projectId}', 'Rolled back', '${expectUuid(users[0])}') RETURNING id;
       ROLLBACK;`,
    ),
  );
  check(
    migrationSql(`SELECT count(*) FROM conversations WHERE id = '${rollbackConversation}';`) ===
      '0' &&
      migrationSql(
        `SELECT count(*) FROM audit_events WHERE aggregate_id = '${rollbackConversation}';`,
      ) === '0' &&
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${rollbackConversation}';`,
      ) === '0',
    'Rolled-back Conversation left entity or event behind',
  );
  const conversationKey = randomUUID();
  check(
    (await call('integration-alice', 'POST', '/v1/conversations', conversationInput)).statusCode ===
      400,
    'Conversation accepted missing idempotency key',
  );
  const createdConversation = await call(
    'integration-alice',
    'POST',
    '/v1/conversations',
    conversationInput,
    { 'idempotency-key': conversationKey },
  );
  check(createdConversation.statusCode === 201, 'Conversation creation failed');
  const conversationId = expectUuid(createdConversation.json().id);
  migrationSql(
    `UPDATE workspace_memberships SET status = 'ACTIVE'
     WHERE workspace_id = '${alpha}' AND user_id = '${bobId}';`,
  );
  check(
    (await call('integration-bob', 'GET', `/v1/conversations/${conversationId}`)).statusCode ===
      200,
    'Shared Conversation was not readable',
  );
  check(
    (
      await call(
        'integration-bob',
        'POST',
        '/v1/conversations',
        {
          ...conversationInput,
          title: 'Denied',
        },
        { 'idempotency-key': randomUUID() },
      )
    ).statusCode === 403,
    'MEMBER created Conversation',
  );
  check(
    (
      await call('integration-bob', 'POST', `/v1/conversations/${conversationId}/archive`, {
        version: 1,
      })
    ).statusCode === 403,
    'MEMBER archived Conversation',
  );
  migrationSql(
    `UPDATE workspace_memberships SET status = 'SUSPENDED'
     WHERE workspace_id = '${alpha}' AND user_id = '${bobId}';`,
  );
  check(
    (
      await call('integration-alice', 'POST', '/v1/conversations', conversationInput, {
        'idempotency-key': conversationKey,
      })
    ).json().id === conversationId,
    'Conversation idempotency replay changed identity',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/conversations/${conversationId}`)).statusCode ===
      404,
    'Bob read Alice Conversation',
  );
  check(
    (await call('integration-alice', 'GET', `/v1/conversations?workspaceId=${alpha}`)).json()
      .conversations[0]?.id === conversationId,
    'Conversation list missed entity',
  );
  const renamedConversation = await call(
    'integration-alice',
    'PATCH',
    `/v1/conversations/${conversationId}`,
    { version: 1, title: 'Revised discussion' },
  );
  check(
    renamedConversation.statusCode === 200 && renamedConversation.json().version === 2,
    'Conversation versioned update failed',
  );
  check(
    (
      await call('integration-alice', 'PATCH', `/v1/conversations/${conversationId}`, {
        version: 1,
        title: 'Stale',
      })
    ).statusCode === 409,
    'Stale Conversation update succeeded',
  );
  const archivedConversation = await call(
    'integration-alice',
    'POST',
    `/v1/conversations/${conversationId}/archive`,
    { version: 2 },
  );
  check(
    archivedConversation.statusCode === 200 && archivedConversation.json().archivedAt,
    'Conversation archive failed',
  );
  check(
    (await call('integration-alice', 'GET', `/v1/conversations/${conversationId}`)).statusCode ===
      404,
    'Archived Conversation remained active',
  );
  check(
    (
      await call('integration-alice', 'GET', `/v1/conversations?workspaceId=${alpha}&archived=true`)
    ).json().conversations[0]?.id === conversationId,
    'Conversation archive list missed entity',
  );
  check(
    (
      await call('integration-alice', 'POST', `/v1/conversations/${conversationId}/restore`, {
        version: 2,
      })
    ).statusCode === 409,
    'Stale Conversation restore succeeded',
  );
  const restoredConversation = await call(
    'integration-alice',
    'POST',
    `/v1/conversations/${conversationId}/restore`,
    { version: 3 },
  );
  check(
    restoredConversation.statusCode === 200 && restoredConversation.json().archivedAt === null,
    'Conversation restore failed',
  );
  for (const eventType of [
    'conversation.created.v1',
    'conversation.updated.v1',
    'conversation.archived.v1',
    'conversation.restored.v1',
  ]) {
    check(
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${conversationId}' AND event_type = '${eventType}';`,
      ) === '1',
      `Conversation ${eventType} outbox missing or duplicated`,
    );
    check(
      migrationSql(
        `SELECT count(*) FROM audit_events WHERE aggregate_id = '${conversationId}' AND action = '${eventType}';`,
      ) === '1',
      `Conversation ${eventType} audit missing or duplicated`,
    );
  }
  const resourceInput = {
    workspaceId: alpha,
    projectId,
    title: 'Market source',
    sourceRef: 'https://example.com/market-source',
  };
  const rollbackResource = expectUuid(
    migrationSql(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${expectUuid(users[0])}';
       INSERT INTO resources(workspace_id, project_id, title, source_ref, created_by)
       VALUES ('${alpha}', '${projectId}', 'Rolled back', 'https://example.com/rollback',
         '${expectUuid(users[0])}') RETURNING id;
       ROLLBACK;`,
    ),
  );
  check(
    migrationSql(`SELECT count(*) FROM resources WHERE id = '${rollbackResource}';`) === '0' &&
      migrationSql(
        `SELECT count(*) FROM audit_events WHERE aggregate_id = '${rollbackResource}';`,
      ) === '0' &&
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${rollbackResource}';`,
      ) === '0',
    'Rolled-back Resource left entity or event behind',
  );
  const resourceKey = randomUUID();
  check(
    (await call('integration-alice', 'POST', '/v1/resources', resourceInput)).statusCode === 400,
    'Resource accepted missing idempotency key',
  );
  const createdResource = await call('integration-alice', 'POST', '/v1/resources', resourceInput, {
    'idempotency-key': resourceKey,
  });
  check(createdResource.statusCode === 201, 'Resource metadata creation failed');
  const resourceId = expectUuid(createdResource.json().id);
  migrationSql(
    `UPDATE workspace_memberships SET status = 'ACTIVE'
     WHERE workspace_id = '${alpha}' AND user_id = '${bobId}';`,
  );
  check(
    (await call('integration-bob', 'GET', `/v1/resources/${resourceId}`)).statusCode === 200,
    'Shared Resource was not readable',
  );
  check(
    (
      await call(
        'integration-bob',
        'POST',
        '/v1/resources',
        {
          ...resourceInput,
          title: 'Denied',
        },
        { 'idempotency-key': randomUUID() },
      )
    ).statusCode === 403,
    'MEMBER created Resource',
  );
  check(
    (
      await call('integration-bob', 'POST', `/v1/resources/${resourceId}/delete`, {
        version: 1,
      })
    ).statusCode === 403,
    'MEMBER deleted Resource',
  );
  migrationSql(
    `UPDATE workspace_memberships SET status = 'SUSPENDED'
     WHERE workspace_id = '${alpha}' AND user_id = '${bobId}';`,
  );
  check(
    (
      await call('integration-alice', 'POST', '/v1/resources', resourceInput, {
        'idempotency-key': resourceKey,
      })
    ).json().id === resourceId,
    'Resource idempotency replay changed identity',
  );
  check(
    (
      await call(
        'integration-alice',
        'POST',
        '/v1/resources',
        {
          ...resourceInput,
          sourceRef: 'https://example.com/changed',
        },
        { 'idempotency-key': resourceKey },
      )
    ).statusCode === 409,
    'Resource accepted changed payload under reused key',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/resources/${resourceId}`)).statusCode === 404,
    'Bob read Alice Resource',
  );
  check(
    (
      await call(
        'integration-alice',
        'GET',
        `/v1/resources?workspaceId=${alpha}&projectId=${projectId}`,
      )
    ).json().resources[0]?.id === resourceId,
    'Resource list missed entity',
  );
  const renamedResource = await call('integration-alice', 'PATCH', `/v1/resources/${resourceId}`, {
    version: 1,
    title: 'Reviewed source',
  });
  check(
    renamedResource.statusCode === 200 && renamedResource.json().version === 2,
    'Resource versioned update failed',
  );
  check(
    (
      await call('integration-alice', 'PATCH', `/v1/resources/${resourceId}`, {
        version: 1,
        title: 'Stale',
      })
    ).statusCode === 409,
    'Stale Resource update succeeded',
  );
  check(
    (
      await call('integration-alice', 'POST', `/v1/resources/${resourceId}/delete`, {
        version: 1,
      })
    ).statusCode === 409,
    'Stale Resource delete succeeded',
  );
  migrationSql(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${expectUuid(users[0])}';
     UPDATE resources SET deleted_at = now(), version = version + 1, updated_by = '${expectUuid(users[0])}'
     WHERE id = '${resourceId}'; ROLLBACK;`,
  );
  check(
    migrationSql(
      `SELECT count(*) FROM retention_requests WHERE aggregate_type = 'Resource' AND aggregate_id = '${resourceId}';`,
    ) === '0' &&
      (await call('integration-alice', 'GET', `/v1/resources/${resourceId}`)).statusCode === 200,
    'Rolled-back Resource deletion retained a handoff or hid the Resource',
  );
  const deletedResource = await call(
    'integration-alice',
    'POST',
    `/v1/resources/${resourceId}/delete`,
    { version: 2 },
  );
  check(
    deletedResource.statusCode === 200 && deletedResource.json().deleted === true,
    'Resource soft delete failed',
  );
  check(
    (await call('integration-alice', 'GET', `/v1/resources/${resourceId}`)).statusCode === 404,
    'Soft-deleted Resource remained visible',
  );
  checkRetention('Resource', resourceId);
  const deletedResourceReplay = await call(
    'integration-alice',
    'POST',
    '/v1/resources',
    resourceInput,
    { 'idempotency-key': resourceKey },
  );
  check(
    deletedResourceReplay.statusCode === 201 &&
      deletedResourceReplay.json().id === resourceId &&
      deletedResourceReplay.json().deletedAt,
    'Deleted Resource create replay lost canonical result',
  );
  for (const eventType of ['resource.created.v1', 'resource.updated.v1', 'resource.deleted.v1']) {
    check(
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${resourceId}' AND event_type = '${eventType}';`,
      ) === '1',
      `Resource ${eventType} outbox missing or duplicated`,
    );
    check(
      migrationSql(
        `SELECT count(*) FROM audit_events WHERE aggregate_id = '${resourceId}' AND action = '${eventType}';`,
      ) === '1',
      `Resource ${eventType} audit missing or duplicated`,
    );
  }
  check(
    (
      await call('integration-alice', 'POST', `/v1/projects/${projectId}/archive`, {
        version: 4,
      })
    ).statusCode === 200,
    'Second Project archive failed',
  );
  check(
    (
      await call('integration-alice', 'POST', '/v1/conversations', conversationInput, {
        'idempotency-key': conversationKey,
      })
    ).json().id === conversationId,
    'Conversation replay failed after linked Project archive',
  );
  check(
    (
      await call('integration-alice', 'POST', '/v1/resources', resourceInput, {
        'idempotency-key': resourceKey,
      })
    ).json().id === resourceId,
    'Resource replay failed after linked Project archive',
  );
  const blockedKey = randomUUID();
  check(
    (
      await call(
        'integration-alice',
        'POST',
        '/v1/resources',
        {
          ...resourceInput,
          title: 'Blocked by archive',
        },
        { 'idempotency-key': blockedKey },
      )
    ).statusCode === 404,
    'New Resource was created under archived Project',
  );
  check(
    migrationSql(
      `SELECT count(*) FROM idempotency_records WHERE workspace_id = '${alpha}' AND key = '${blockedKey}';`,
    ) === '0',
    'Rejected Resource create stranded idempotency reservation',
  );
  check(
    (
      await call('integration-alice', 'POST', `/v1/projects/${projectId}/restore`, {
        version: 5,
      })
    ).statusCode === 200,
    'Second Project restore failed',
  );
  const cancelDraft = await call(
    'integration-alice',
    'POST',
    '/v1/tasks',
    { workspaceId: alpha, title: 'Cancel draft', goal: 'Stop before execution', type: 'WORK' },
    { 'idempotency-key': randomUUID() },
  );
  const cancelDraftId = expectUuid(cancelDraft.json().id);
  const cancelDraftPath = `/v1/tasks/${cancelDraftId}/cancel`;
  const cancelDraftKey = randomUUID();
  check(
    (
      await call(
        'integration-bob',
        'POST',
        cancelDraftPath,
        { version: 1 },
        {
          'idempotency-key': cancelDraftKey,
        },
      )
    ).statusCode === 404,
    'Suspended member canceled a Draft Task',
  );
  const canceledDraft = await call(
    'integration-alice',
    'POST',
    cancelDraftPath,
    { version: 1 },
    {
      'idempotency-key': cancelDraftKey,
    },
  );
  check(
    canceledDraft.statusCode === 200 &&
      canceledDraft.json().status === 'CANCELED' &&
      canceledDraft.json().runId === null &&
      canceledDraft.json().version === 2,
    'Draft Task did not cancel without creating a Run',
  );
  check(
    (
      await call(
        'integration-alice',
        'POST',
        cancelDraftPath,
        { version: 1 },
        {
          'idempotency-key': cancelDraftKey,
        },
      )
    ).json().version === 2,
    'Draft cancellation replay did not preserve the canonical result',
  );
  const startDraft = await call(
    'integration-alice',
    'POST',
    '/v1/tasks',
    {
      workspaceId: alpha,
      title: 'Durable start handoff',
      goal: 'Verify the canonical start transaction',
      type: 'RESEARCH',
    },
    { 'idempotency-key': randomUUID() },
  );
  check(startDraft.statusCode === 201, 'Task start fixture could not be created');
  const startTaskId = expectUuid(startDraft.json().id);
  const startPath = `/v1/tasks/${startTaskId}/start`;
  const startKey = randomUUID();
  check(
    (
      await call(
        'integration-bob',
        'POST',
        startPath,
        { version: 1 },
        { 'idempotency-key': startKey },
      )
    ).statusCode === 404,
    'Suspended member started Task',
  );
  check(
    (await call('integration-alice', 'POST', startPath, { version: 1 })).statusCode === 400,
    'Task start accepted a missing idempotency key',
  );
  const startResponse = await call(
    'integration-alice',
    'POST',
    startPath,
    { version: 1 },
    { 'idempotency-key': startKey },
  );
  const startedRunId = expectUuid(startResponse.json().runId);
  testResultKey = `workspaces/${alpha}/tasks/${startTaskId}/runs/${startedRunId}/result.txt`;
  check(
    startResponse.statusCode === 202 &&
      startResponse.json().status === 'QUEUED' &&
      startResponse.json().version === 2,
    'Authorized Task start did not create a queued Run',
  );
  check(
    (
      await call(
        'integration-alice',
        'POST',
        startPath,
        { version: 1 },
        {
          'idempotency-key': startKey,
        },
      )
    ).json().runId === startedRunId,
    'Task start idempotency replay changed Run identity',
  );
  check(
    (
      await call(
        'integration-alice',
        'POST',
        startPath,
        { version: 2 },
        {
          'idempotency-key': startKey,
        },
      )
    ).statusCode === 409,
    'Task start accepted reused idempotency key with changed version',
  );
  const rejectedStartKey = randomUUID();
  check(
    (
      await call(
        'integration-alice',
        'POST',
        startPath,
        { version: 1 },
        {
          'idempotency-key': rejectedStartKey,
        },
      )
    ).statusCode === 409 &&
      migrationSql(
        `SELECT count(*) FROM idempotency_records WHERE workspace_id = '${alpha}' AND key = '${rejectedStartKey}';`,
      ) === '0',
    'Rejected Task start stranded an idempotency reservation',
  );
  const queued = await call('integration-alice', 'GET', `/v1/tasks/${startTaskId}`);
  check(
    queued.json().status === 'QUEUED' && queued.json().currentRunId === startedRunId,
    'Queued Task lost its canonical Run identity',
  );
  check(
    migrationSql(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${startTaskId}' AND event_type = 'task.status_changed.v1';`,
    ) === '1',
    'Task start did not write exactly one transactional Outbox event',
  );
  const claimedStarts = await pool.query<{
    event_id: string;
    task_id: string;
    run_id: string;
    claim_token: string;
    attempts: number;
  }>('SELECT * FROM ayra.claim_task_start_events($1)', [50]);
  const firstClaim = claimedStarts.rows.find((event) => event.task_id === startTaskId);
  check(
    firstClaim?.run_id === startedRunId && firstClaim.attempts === 1,
    'Outbox Worker could not claim the committed Task start',
  );
  if (!firstClaim) throw new Error('Missing Task start Outbox claim');
  migrationSql(
    `UPDATE outbox_events SET lease_until = now() - interval '1 second' WHERE id = '${expectUuid(firstClaim.event_id)}';`,
  );
  const reclaimedStarts = await pool.query<typeof firstClaim>(
    'SELECT * FROM ayra.claim_task_start_events($1)',
    [50],
  );
  const secondClaim = reclaimedStarts.rows.find((event) => event.event_id === firstClaim.event_id);
  check(
    secondClaim?.attempts === 2 && secondClaim.claim_token !== firstClaim.claim_token,
    'Expired Outbox lease could not be reclaimed after Worker interruption',
  );
  if (!secondClaim) throw new Error('Missing reclaimed Task start event');
  check(
    (
      await pool.query<{ acknowledged: boolean }>(
        'SELECT ayra.ack_task_start_event($1, $2) AS acknowledged',
        [firstClaim.event_id, firstClaim.claim_token],
      )
    ).rows[0]?.acknowledged === false,
    'Stale Worker lease acknowledged a reclaimed event',
  );
  check(
    (
      await pool.query<{ acknowledged: boolean }>(
        'SELECT ayra.ack_task_start_event($1, $2) AS acknowledged',
        [secondClaim.event_id, secondClaim.claim_token],
      )
    ).rows[0]?.acknowledged === true,
    'Current Worker lease could not acknowledge dispatch',
  );
  check(
    migrationSql(
      `SELECT count(*) FROM outbox_events WHERE id = '${expectUuid(firstClaim.event_id)}' AND published_at IS NOT NULL;`,
    ) === '1',
    'Acknowledged Task start remained pending',
  );
  migrationSql(
    `UPDATE outbox_events SET published_at = NULL WHERE id = '${expectUuid(firstClaim.event_id)}';`,
  );
  const startedWorkflowIds: string[] = [];
  const dispatched = await dispatchTaskStartBatch(pool, async (runId, workflowId) => {
    check(runId === startedRunId, 'Outbox dispatcher changed AYRA Run identity');
    startedWorkflowIds.push(workflowId);
  });
  check(
    dispatched.started === 1 &&
      startedWorkflowIds[0] === workflowIdForRun(startedRunId) &&
      migrationSql(
        `SELECT count(*) FROM outbox_events WHERE id = '${expectUuid(firstClaim.event_id)}' AND published_at IS NOT NULL;`,
      ) === '1',
    'Outbox dispatcher did not deliver and acknowledge the committed Task start',
  );
  const executionSnapshot = await pool.query<{ task_id: string; goal: string }>(
    'SELECT * FROM ayra.load_task_run($1)',
    [startedRunId],
  );
  check(
    executionSnapshot.rows[0]?.task_id === startTaskId &&
      executionSnapshot.rows[0]?.goal === 'Verify the canonical start transaction',
    'Worker could not load the canonical queued Task by Run ID',
  );
  let rejectedSkip = false;
  try {
    await pool.query('SELECT ayra.worker_task_transition($1, $2)', [startedRunId, 'PLANNING']);
  } catch {
    rejectedSkip = true;
  }
  check(rejectedSkip, 'Worker skipped the PostgreSQL Task transition guard');
  migrationSql(
    `UPDATE outbox_events SET published_at = NULL WHERE id = '${expectUuid(firstClaim.event_id)}';`,
  );
  const m3WorkflowTest = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('../../worker/scripts/test-db-task-workflow.ts', import.meta.url)),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AYRA_TEST_RUN_ID: startedRunId,
        AYRA_TEST_ACTOR_ID: expectUuid(users[0]),
        AYRA_TEST_KEEP_RESULT_OBJECT: '1',
      },
      encoding: 'utf8',
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  check(
    m3WorkflowTest.status === 0 && m3WorkflowTest.stdout.includes('PASS: DB Task survived'),
    `DB + Temporal Task Workflow integration failed (${m3WorkflowTest.status})`,
  );
  const completedTask = await call('integration-alice', 'GET', `/v1/tasks/${startTaskId}`);
  check(
    completedTask.json().status === 'COMPLETED' &&
      completedTask.json().currentRunId === startedRunId &&
      migrationSql(`SELECT status FROM runs WHERE id = '${startedRunId}';`) === 'COMPLETED',
    'Temporal Workflow did not commit canonical Task and Run completion',
  );
  check(
    migrationSql(
      `SELECT count(*) FROM artifacts WHERE run_id = '${startedRunId}' AND provenance->>'kind' = 'RUN_RESULT';`,
    ) === '1',
    'Completed Task did not create exactly one Task-backed result Artifact',
  );
  const resultArtifactId = expectUuid(
    migrationSql(
      `SELECT id FROM artifacts WHERE run_id = '${startedRunId}' AND provenance->>'kind' = 'RUN_RESULT';`,
    ),
  );
  const signedAccess = await call(
    'integration-alice',
    'GET',
    `/v1/artifacts/${resultArtifactId}/access`,
  );
  check(signedAccess.statusCode === 200, 'Task result Artifact did not provide signed access');
  check(
    signedAccess.headers['cache-control'] === 'no-store',
    'Signed access response was cacheable',
  );
  const resultDownload = await fetch(signedAccess.json().url);
  const resultText = await resultDownload.text();
  check(
    resultDownload.ok && resultText.startsWith('output: plan: understood:'),
    `Signed result URL did not download canonical bytes (${resultDownload.status}: ${resultText.slice(0, 240)})`,
  );
  check(
    (await call('integration-bob', 'GET', `/v1/artifacts/${resultArtifactId}/access`))
      .statusCode === 404,
    'Suspended member received signed Artifact access',
  );
  check(
    (
      await pool.query<{ result: string }>('SELECT ayra.worker_task_transition($1, $2) AS result', [
        startedRunId,
        'COMPLETED',
      ])
    ).rows[0]?.result === 'UNCHANGED',
    'Repeated Worker completion rewrote canonical Task state',
  );
  check(
    migrationSql(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${startTaskId}' AND event_type = 'task.status_changed.v1';`,
    ) === '6',
    'Worker stage changes lost or duplicated transactional Task events',
  );
  const cancelQueuedDraft = await call(
    'integration-alice',
    'POST',
    '/v1/tasks',
    { workspaceId: alpha, title: 'Cancel queued', goal: 'Stop before dispatch', type: 'WORK' },
    { 'idempotency-key': randomUUID() },
  );
  const cancelQueuedId = expectUuid(cancelQueuedDraft.json().id);
  const cancelQueuedStart = await call(
    'integration-alice',
    'POST',
    `/v1/tasks/${cancelQueuedId}/start`,
    { version: 1 },
    { 'idempotency-key': randomUUID() },
  );
  const cancelQueuedRunId = expectUuid(cancelQueuedStart.json().runId);
  const canceledQueued = await call(
    'integration-alice',
    'POST',
    `/v1/tasks/${cancelQueuedId}/cancel`,
    { version: 2 },
    { 'idempotency-key': randomUUID() },
  );
  check(
    canceledQueued.statusCode === 200 &&
      canceledQueued.json().status === 'CANCELED' &&
      canceledQueued.json().runId === cancelQueuedRunId &&
      canceledQueued.json().version === 3 &&
      migrationSql(`SELECT status FROM runs WHERE id = '${cancelQueuedRunId}';`) === 'CANCELED',
    'Queued cancellation did not atomically stop Task and Run',
  );
  const cancelDispatch = await dispatchTaskStartBatch(pool, async () => {
    throw new Error('Canceled Run must not start a Workflow');
  });
  check(
    cancelDispatch.started === 0 && cancelDispatch.skipped >= 1 && cancelDispatch.failed === 0,
    'Canceled queued Run was dispatched or stranded',
  );
  const staleCancelKey = randomUUID();
  check(
    (
      await call(
        'integration-alice',
        'POST',
        `/v1/tasks/${cancelQueuedId}/cancel`,
        { version: 2 },
        { 'idempotency-key': staleCancelKey },
      )
    ).statusCode === 409 &&
      migrationSql(
        `SELECT count(*) FROM idempotency_records WHERE workspace_id = '${alpha}' AND key = '${staleCancelKey}';`,
      ) === '0',
    'Rejected cancellation stranded an idempotency reservation',
  );
  check(
    (
      await call('integration-alice', 'POST', `/v1/account/sessions/${currentSessionId}/revoke`)
    ).json().revoked === true,
    'Current session could not be revoked',
  );
  check(
    (await call('integration-alice', 'GET', '/v1/account')).statusCode === 401,
    'Explicitly revoked current session retained access',
  );
  console.info(
    'PASS: verified-session API account, workspace creation, and cross-tenant isolation.',
  );
} finally {
  await app.close();
  await pool.end();
  if (testResultKey) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: testResultKey }));
    } catch {
      cleanupFailed = true;
    }
  }
  s3.destroy();
  if (users.length) {
    const ids = users
      .map(expectUuid)
      .map((id) => `'${id}'`)
      .join(',');
    const workspaceDelete = workspaces.length
      ? `DELETE FROM idempotency_records WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM retention_requests WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM approvals WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM artifacts WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(
            ',',
          )}); UPDATE tasks SET current_run_id = NULL, version = version + 1 WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(
            ',',
          )}) AND current_run_id IS NOT NULL; DELETE FROM runs WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM resources WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM conversations WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM tasks WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM projects WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM audit_events WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM outbox_events WHERE workspace_id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')}); DELETE FROM workspaces WHERE id IN (${workspaces
          .map(expectUuid)
          .map((id) => `'${id}'`)
          .join(',')});`
      : '';
    const cleanup = spawnSync(
      'docker',
      [
        'exec',
        '-i',
        'ayra-local-postgres-1',
        'psql',
        '-X',
        '-q',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'migration_role',
        '-d',
        'ayra',
      ],
      {
        input: `BEGIN; SELECT set_config('ayra.actor_user_id', '${expectUuid(users[0])}', true); DELETE FROM workspace_memberships WHERE user_id IN (${ids}); ${workspaceDelete} DELETE FROM account_sessions WHERE user_id IN (${ids}); DELETE FROM external_identities WHERE user_id IN (${ids}); DELETE FROM users WHERE id IN (${ids}); COMMIT;`,
        encoding: 'utf8',
        stdio: ['pipe', 'ignore', 'ignore'],
      },
    );
    if (cleanup.status !== 0) cleanupFailed = true;
  }
}
if (cleanupFailed) throw new Error('Integration fixture cleanup failed');
