import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const container = 'ayra-local-postgres-1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function query(statement, application = false) {
  const args = application
    ? [
        'exec',
        '-i',
        container,
        'sh',
        '-ec',
        'PGPASSWORD="$APPLICATION_DB_PASSWORD" exec psql -h 127.0.0.1 -U application_role -d ayra -X -qAt -v ON_ERROR_STOP=1',
      ]
    : [
        'exec',
        '-i',
        container,
        'psql',
        '-U',
        'migration_role',
        '-d',
        'ayra',
        '-X',
        '-qAt',
        '-v',
        'ON_ERROR_STOP=1',
      ];
  const result = spawnSync('docker', args, { input: statement, encoding: 'utf8' });
  if (result.error || result.status !== 0)
    throw new Error(
      `RLS integration SQL failed for ${application ? 'application' : 'migration'} role; details suppressed.`,
    );
  return result.stdout.trim();
}
function requireUuid(value) {
  if (!uuidPattern.test(value)) throw new Error('Expected a UUID from PostgreSQL');
  return value;
}
function asActor(actor, statement) {
  requireUuid(actor);
  return query(`BEGIN; SET LOCAL ayra.actor_user_id = '${actor}'; ${statement}; COMMIT;`, true);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const nonce = randomUUID().replaceAll('-', '');
const users = [];
const workspaces = [];
try {
  for (const suffix of ['a', 'b']) {
    const user = requireUuid(
      query(`INSERT INTO users(display_name) VALUES ('rls-${nonce}-${suffix}') RETURNING id;`),
    );
    users.push(user);
    workspaces.push(
      requireUuid(asActor(user, `SELECT ayra.create_workspace('rls-${nonce}-${suffix}')`)),
    );
  }
  const [alice, bob] = users;
  const [alpha, beta] = workspaces;
  assert(
    asActor(alice, 'SELECT current_user') === 'application_role',
    'Did not use application_role',
  );
  assert(
    asActor(alice, `SELECT id FROM workspaces WHERE id = '${alpha}'`) === alpha,
    'Owner cannot read own workspace',
  );
  assert(
    asActor(alice, `SELECT id FROM workspaces WHERE id = '${beta}'`) === '',
    'Alice read Bob workspace',
  );
  assert(
    asActor(bob, `SELECT id FROM workspaces WHERE id = '${alpha}'`) === '',
    'Bob read Alice workspace',
  );
  assert(
    asActor(alice, `SELECT id FROM workspace_memberships WHERE workspace_id = '${beta}'`) === '',
    'Alice read Bob membership',
  );
  assert(
    asActor(alice, `UPDATE workspaces SET name = 'denied' WHERE id = '${beta}' RETURNING id`) ===
      '',
    'Alice modified Bob workspace',
  );
  assert(
    asActor(bob, `SELECT id FROM users WHERE id = '${alice}'`) === '',
    'Bob read Alice account',
  );
  assert(
    asActor(alice, `SELECT id FROM workspaces WHERE id = '${beta}'`) === '',
    'Cross-tenant read changed after denied write',
  );
  query(
    `INSERT INTO workspace_memberships(workspace_id, user_id, role, status) VALUES ('${alpha}', '${bob}', 'MEMBER', 'ACTIVE');`,
  );
  assert(
    asActor(bob, `SELECT id FROM workspaces WHERE id = '${alpha}'`) === alpha,
    'Active member cannot read shared workspace',
  );
  assert(
    asActor(bob, `UPDATE workspaces SET name = 'denied' WHERE id = '${alpha}' RETURNING id`) === '',
    'MEMBER modified an OWNER-only workspace',
  );
  query(
    `UPDATE workspace_memberships SET status = 'SUSPENDED' WHERE workspace_id = '${alpha}' AND user_id = '${bob}';`,
  );
  assert(
    asActor(bob, `SELECT id FROM workspaces WHERE id = '${alpha}'`) === '',
    'Suspended member retained workspace access',
  );
  console.info('PASS: application_role ownership, account and cross-workspace RLS isolation.');
} finally {
  if (users.length) {
    const safeUsers = users
      .map(requireUuid)
      .map((id) => `'${id}'`)
      .join(',');
    query(
      `BEGIN; DELETE FROM workspace_memberships WHERE user_id IN (${safeUsers}); DELETE FROM workspaces WHERE id IN (SELECT id FROM workspaces WHERE name LIKE 'rls-${nonce}-%'); DELETE FROM users WHERE id IN (${safeUsers}); COMMIT;`,
    );
  }
}
