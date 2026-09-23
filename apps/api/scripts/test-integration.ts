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
async function call(token: string, method: 'GET' | 'POST', url: string, payload?: object) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${tokens[token] ?? token}` },
    ...(payload ? { payload } : {}),
  });
}
function check(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
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
      ? `DELETE FROM workspaces WHERE id IN (${workspaces
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
