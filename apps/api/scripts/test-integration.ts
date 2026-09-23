import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import pg from 'pg';
import { createClerkIdentityProvider } from '@ayra/auth';
import { createApp } from '../src/app';

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
const app = await createApp({ identity, pool });
let cleanupFailed = false;
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
  migrationSql(
    `UPDATE workspace_memberships SET status = 'SUSPENDED' WHERE workspace_id = '${alpha}' AND user_id = '${bobId}';`,
  );
  check(
    (await call('integration-bob', 'GET', `/v1/projects/${projectId}`)).statusCode === 404,
    'Suspended member retained Project access',
  );
  check(
    (await call('integration-bob', 'GET', `/v1/tasks/${taskId}`)).statusCode === 404,
    'Suspended member retained Task access',
  );
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
  if (users.length) {
    const ids = users
      .map(expectUuid)
      .map((id) => `'${id}'`)
      .join(',');
    const workspaceDelete = workspaces.length
      ? `DELETE FROM idempotency_records WHERE workspace_id IN (${workspaces
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
        input: `BEGIN; DELETE FROM workspace_memberships WHERE user_id IN (${ids}); ${workspaceDelete} DELETE FROM account_sessions WHERE user_id IN (${ids}); DELETE FROM external_identities WHERE user_id IN (${ids}); DELETE FROM users WHERE id IN (${ids}); COMMIT;`,
        encoding: 'utf8',
        stdio: ['pipe', 'ignore', 'ignore'],
      },
    );
    if (cleanup.status !== 0) cleanupFailed = true;
  }
}
if (cleanupFailed) throw new Error('Integration fixture cleanup failed');
