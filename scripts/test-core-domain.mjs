import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const container = 'ayra-local-postgres-1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value) {
  if (!uuidPattern.test(value)) throw new Error('Expected PostgreSQL UUID');
  return value;
}
function execute(statement, application = false) {
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
  const result = spawnSync('docker', args, {
    input: statement,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { status: result.status, output: result.stdout.trim() };
}
function query(statement, application = false) {
  const result = execute(statement, application);
  if (result.status !== 0) throw new Error('Core domain SQL failed; details suppressed');
  return result.output;
}
function asActor(actor, statement) {
  return query(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${uuid(actor)}'; ${statement}; COMMIT;`,
    true,
  );
}
function expectFailure(statement, application = false) {
  if (execute(statement, application).status === 0)
    throw new Error('Expected database invariant rejection');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const nonce = randomUUID().replaceAll('-', '');
const users = [];
const workspaces = [];
try {
  for (const suffix of ['a', 'b']) {
    const user = uuid(
      query(`INSERT INTO users(display_name) VALUES ('m2-${nonce}-${suffix}') RETURNING id;`),
    );
    users.push(user);
    workspaces.push(uuid(asActor(user, `SELECT ayra.create_workspace('m2-${nonce}-${suffix}')`)));
  }
  const [alice, bob] = users;
  const [alpha, beta] = workspaces;
  if (!alice || !bob || !alpha || !beta) throw new Error('Fixture setup incomplete');

  const project = uuid(
    asActor(
      alice,
      `INSERT INTO projects(workspace_id,name,created_by) VALUES ('${alpha}','m2-${nonce}-project','${alice}') RETURNING id`,
    ),
  );
  assert(
    query(`SELECT count(*) FROM audit_events WHERE aggregate_id = '${project}'`) === '1',
    'Project audit missing',
  );
  assert(
    query(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${project}' AND event_type = 'project.created.v1'`,
    ) === '1',
    'Project outbox missing',
  );
  const rolledBack = uuid(
    query(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; INSERT INTO projects(workspace_id,name,created_by) VALUES ('${alpha}','m2-${nonce}-rollback','${alice}') RETURNING id; ROLLBACK;`,
      true,
    ),
  );
  assert(
    query(`SELECT count(*) FROM projects WHERE id = '${rolledBack}'`) === '0',
    'Rolled-back Project survived',
  );
  assert(
    query(`SELECT count(*) FROM audit_events WHERE aggregate_id = '${rolledBack}'`) === '0',
    'Rolled-back audit survived',
  );
  assert(
    query(`SELECT count(*) FROM outbox_events WHERE aggregate_id = '${rolledBack}'`) === '0',
    'Rolled-back outbox survived',
  );
  expectFailure(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${bob}'; INSERT INTO projects(workspace_id,name,created_by) VALUES ('${alpha}','denied','${bob}'); COMMIT;`,
    true,
  );
  assert(
    asActor(bob, `SELECT id FROM projects WHERE id = '${project}'`) === '',
    'Cross-tenant Project read succeeded',
  );

  assert(
    asActor(
      alice,
      `UPDATE projects SET name = 'changed', version = 2, updated_by = '${alice}' WHERE id = '${project}' AND version = 1 RETURNING version`,
    ) === '2',
    'Optimistic update failed',
  );
  assert(
    query(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${project}' AND event_type = 'project.updated.v1'`,
    ) === '1',
    'Project update outbox missing',
  );
  assert(
    query(
      `SELECT count(*) FROM audit_events WHERE aggregate_id = '${project}' AND action = 'project.updated.v1'`,
    ) === '1',
    'Project update audit missing',
  );
  assert(
    asActor(
      alice,
      `UPDATE projects SET name = 'stale', version = 2 WHERE id = '${project}' AND version = 1 RETURNING id`,
    ) === '',
    'Stale version updated Project',
  );
  expectFailure(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE projects SET name = 'skip-version' WHERE id = '${project}'; COMMIT;`,
    true,
  );
  query(
    `INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES ('${alpha}','${bob}','MEMBER','ACTIVE');`,
  );
  assert(
    asActor(bob, `SELECT id FROM projects WHERE id = '${project}'`) === project,
    'Active MEMBER cannot read Project',
  );
  assert(
    asActor(
      bob,
      `UPDATE projects SET name = 'denied', version = 3 WHERE id = '${project}' RETURNING id`,
    ) === '',
    'MEMBER wrote Project through database',
  );
  query(
    `UPDATE workspace_memberships SET status = 'SUSPENDED' WHERE workspace_id = '${alpha}' AND user_id = '${bob}';`,
  );
  assert(
    asActor(bob, `SELECT id FROM projects WHERE id = '${project}'`) === '',
    'Suspended MEMBER retained Project read',
  );

  const task = uuid(
    query(
      `INSERT INTO tasks(workspace_id,project_id,title,goal,type,created_by) VALUES ('${alpha}','${project}','Task','Deliver result','WORK','${alice}') RETURNING id;`,
    ),
  );
  assert(
    query(
      `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${task}' AND event_type = 'task.created.v1'`,
    ) === '1',
    'Task creation outbox missing',
  );
  assert(
    query(
      `SELECT count(*) FROM audit_events WHERE aggregate_id = '${task}' AND action = 'task.created.v1'`,
    ) === '1',
    'Task creation audit missing',
  );
  const rolledBackTask = uuid(
    query(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; INSERT INTO tasks(workspace_id,title,goal,type,created_by) VALUES ('${alpha}','Rollback Task','No commit','WORK','${alice}') RETURNING id; ROLLBACK;`,
    ),
  );
  assert(
    query(`SELECT count(*) FROM tasks WHERE id = '${rolledBackTask}'`) === '0',
    'Rolled-back Task survived',
  );
  assert(
    query(`SELECT count(*) FROM audit_events WHERE aggregate_id = '${rolledBackTask}'`) === '0',
    'Rolled-back Task audit survived',
  );
  assert(
    query(`SELECT count(*) FROM outbox_events WHERE aggregate_id = '${rolledBackTask}'`) === '0',
    'Rolled-back Task outbox survived',
  );
  const otherTask = uuid(
    query(
      `INSERT INTO tasks(workspace_id,title,goal,type,created_by) VALUES ('${alpha}','Other','Other goal','WORK','${alice}') RETURNING id;`,
    ),
  );
  const stateTask = uuid(
    query(
      `INSERT INTO tasks(workspace_id,title,goal,type,created_by) VALUES ('${alpha}','State Task','Check transitions','WORK','${alice}') RETURNING id;`,
    ),
  );
  expectFailure(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE tasks SET status = 'COMPLETED', version = 2 WHERE id = '${stateTask}'; COMMIT;`,
  );
  expectFailure(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE tasks SET status = 'QUEUED', version = 2 WHERE id = '${stateTask}'; COMMIT;`,
    true,
  );
  for (const status of [
    'QUEUED',
    'UNDERSTANDING',
    'BLOCKED',
    'UNDERSTANDING',
    'PLANNING',
    'RUNNING',
    'PAUSED',
    'RUNNING',
    'WAITING_APPROVAL',
    'RUNNING',
    'VERIFYING',
    'COMPLETED',
  ]) {
    query(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE tasks SET status = '${status}', version = version + 1 WHERE id = '${stateTask}'; COMMIT;`,
    );
    if (status === 'BLOCKED' || status === 'PAUSED') {
      const expected = status === 'BLOCKED' ? 'UNDERSTANDING' : 'RUNNING';
      assert(
        query(`SELECT resume_status FROM tasks WHERE id = '${stateTask}'`) === expected,
        'Interrupted Task lost its resume stage',
      );
      expectFailure(
        `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE tasks SET status = 'VERIFYING', version = version + 1 WHERE id = '${stateTask}'; COMMIT;`,
      );
    }
  }
  assert(
    query(
      `SELECT status || ':' || coalesce(resume_status, 'none') FROM tasks WHERE id = '${stateTask}'`,
    ) === 'COMPLETED:none',
    'Completed Task retained interrupted state',
  );
  expectFailure(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE tasks SET status = 'RUNNING', version = version + 1 WHERE id = '${stateTask}'; COMMIT;`,
  );
  const run = uuid(
    query(
      `INSERT INTO runs(workspace_id,task_id,attempt,status,created_by) VALUES ('${alpha}','${task}',1,'PENDING','${alice}') RETURNING id;`,
    ),
  );
  const otherRun = uuid(
    query(
      `INSERT INTO runs(workspace_id,task_id,attempt,status,created_by) VALUES ('${alpha}','${otherTask}',1,'PENDING','${alice}') RETURNING id;`,
    ),
  );
  query(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE tasks SET current_run_id = '${run}', version = 2 WHERE id = '${task}'; COMMIT;`,
  );
  assert(
    query(`SELECT current_run_id FROM tasks WHERE id = '${task}'`) === run,
    'Task/Run mapping failed',
  );
  expectFailure(
    `INSERT INTO tasks(workspace_id,project_id,title,goal,type,created_by) VALUES ('${beta}','${project}','Wrong tenant','Goal','WORK','${bob}');`,
  );
  expectFailure(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE tasks SET current_run_id = '${otherRun}', version = 3 WHERE id = '${task}'; COMMIT;`,
  );

  const artifact = uuid(
    query(
      `INSERT INTO artifacts(workspace_id,task_id,run_id,title,object_ref,created_by) VALUES ('${alpha}','${task}','${run}','Output','s3://test/output','${alice}') RETURNING id;`,
    ),
  );
  assert(Boolean(artifact), 'Task-backed Artifact missing');
  expectFailure(
    `INSERT INTO artifacts(workspace_id,title,object_ref,created_by) VALUES ('${alpha}','Orphan','s3://test/orphan','${alice}');`,
  );
  expectFailure(
    `INSERT INTO artifacts(workspace_id,task_id,run_id,title,object_ref,created_by) VALUES ('${alpha}','${task}','${otherRun}','Wrong run','s3://test/wrong','${alice}');`,
  );
  const approval = uuid(
    query(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; INSERT INTO approvals(workspace_id,user_id,task_id,run_id,action,resource_ref,arguments_hash,state_version,expires_at) VALUES ('${alpha}','${alice}','${task}','${run}','write','resource','${'a'.repeat(64)}',1,now()+interval '1 hour') RETURNING id; COMMIT;`,
    ),
  );
  assert(Boolean(approval), 'Run-bound Approval missing');
  expectFailure(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; INSERT INTO approvals(workspace_id,user_id,task_id,run_id,action,resource_ref,arguments_hash,state_version,expires_at) VALUES ('${alpha}','${alice}','${task}','${otherRun}','write','resource','${'a'.repeat(64)}',1,now()+interval '1 hour'); COMMIT;`,
  );
  for (const status of ['QUEUED', 'UNDERSTANDING', 'PLANNING', 'RUNNING', 'WAITING_APPROVAL'])
    query(
      `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE tasks SET status = '${status}', version = version + 1 WHERE id = '${task}'; COMMIT;`,
    );
  const approvalStateVersion = Number(query(`SELECT version FROM tasks WHERE id = '${task}'`));
  const requestDecision = (suffix) =>
    uuid(
      asActor(
        alice,
        `INSERT INTO approvals(workspace_id,user_id,task_id,run_id,action,resource_ref,arguments_hash,state_version,expires_at) VALUES ('${alpha}','${alice}','${task}','${run}','write','resource-${suffix}','${'b'.repeat(64)}',${approvalStateVersion},now()+interval '1 hour') RETURNING id`,
      ),
    );
  const approved = requestDecision('approve');
  expectFailure(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; SELECT ayra.decide_approval('${approved}',NULL,'APPROVED'); COMMIT;`,
    true,
  );
  expectFailure(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; SELECT ayra.decide_approval('${approved}',1,NULL); COMMIT;`,
    true,
  );
  assert(
    asActor(bob, `SELECT ayra.decide_approval('${approved}',1,'APPROVED')`) === 'NOT_FOUND',
    'Suspended Workspace member decided an Approval',
  );
  query(
    `UPDATE workspace_memberships SET status = 'ACTIVE' WHERE workspace_id = '${alpha}' AND user_id = '${bob}'`,
  );
  assert(
    asActor(bob, `SELECT ayra.decide_approval('${approved}',1,'APPROVED')`) === 'NOT_FOUND',
    'Active non-target Workspace member decided an Approval',
  );
  assert(
    asActor(alice, `SELECT ayra.decide_approval('${approved}',2,'APPROVED')`) === 'CONFLICT',
    'Stale Approval version was accepted',
  );
  assert(
    asActor(alice, `SELECT ayra.decide_approval('${approved}',1,'APPROVED')`) === 'APPROVED',
    'Target user could not approve current Task state',
  );
  assert(
    asActor(alice, `SELECT ayra.decide_approval('${approved}',1,'APPROVED')`) === 'CONFLICT' &&
      query(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${approved}' AND event_type = 'approval.approved.v1'`,
      ) === '1',
    'Approval replay duplicated the decision event',
  );
  const consume = (actor, id, resourceRef, hash = 'b'.repeat(64), version = approvalStateVersion) =>
    asActor(
      actor,
      `SELECT ayra.consume_approval('${id}','${run}','write','${resourceRef}','${hash}',${version})`,
    );
  assert(
    consume(alice, approved, 'resource-approve') === 'INVALID',
    'Approval was consumed before its Run became active',
  );
  query(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE runs SET status = 'RUNNING', version = version + 1 WHERE id = '${run}'; COMMIT;`,
  );
  assert(
    consume(bob, approved, 'resource-approve') === 'INVALID' &&
      consume(alice, approved, 'wrong-resource') === 'INVALID' &&
      consume(alice, approved, 'resource-approve', 'c'.repeat(64)) === 'INVALID' &&
      consume(alice, approved, 'resource-approve', 'b'.repeat(64), approvalStateVersion + 1) ===
        'INVALID',
    'Mismatched Approval binding was consumed',
  );
  assert(
    consume(alice, approved, 'resource-approve') === 'CONSUMED' &&
      consume(alice, approved, 'resource-approve') === 'INVALID' &&
      query(
        `SELECT count(*) FROM outbox_events WHERE aggregate_id = '${approved}' AND event_type = 'approval.consumed.v1'`,
      ) === '1',
    'Approval consumption was not single-use and audited',
  );
  const delegated = uuid(
    asActor(
      alice,
      `INSERT INTO approvals(workspace_id,user_id,task_id,run_id,action,resource_ref,arguments_hash,state_version,expires_at) VALUES ('${alpha}','${bob}','${task}','${run}','write','resource-delegated','${'b'.repeat(64)}',${approvalStateVersion},now()+interval '1 hour') RETURNING id`,
    ),
  );
  assert(
    asActor(bob, `SELECT ayra.decide_approval('${delegated}',1,'APPROVED')`) === 'APPROVED',
    'Active target member could not approve a request',
  );
  query(
    `UPDATE workspace_memberships SET status = 'SUSPENDED' WHERE workspace_id = '${alpha}' AND user_id = '${bob}'`,
  );
  assert(
    consume(alice, delegated, 'resource-delegated') === 'INVALID',
    'Revoked approver retained authorization for external action',
  );
  const rejected = requestDecision('reject');
  assert(
    asActor(alice, `SELECT ayra.decide_approval('${rejected}',1,'REJECTED')`) === 'REJECTED',
    'Target user could not reject an Approval',
  );
  const expired = requestDecision('expire');
  query(
    `UPDATE approvals SET expires_at = now() - interval '1 second', version = version + 1 WHERE id = '${expired}'`,
  );
  assert(
    asActor(alice, `SELECT ayra.decide_approval('${expired}',2,'APPROVED')`) === 'EXPIRED' &&
      query(`SELECT status FROM approvals WHERE id = '${expired}'`) === 'EXPIRED',
    'Expired Approval was accepted',
  );
  const stale = requestDecision('stale');
  query(
    `BEGIN; SET LOCAL ayra.actor_user_id = '${alice}'; UPDATE tasks SET status = 'RUNNING', version = version + 1 WHERE id = '${task}'; COMMIT;`,
  );
  assert(
    asActor(alice, `SELECT ayra.decide_approval('${stale}',1,'APPROVED')`) === 'STALE' &&
      query(`SELECT status FROM approvals WHERE id = '${stale}'`) === 'REVOKED',
    'Changed Task state did not invalidate Approval',
  );
  console.info(
    'PASS: M2 invariants and M5 Approval decision, consumption, revocation, and event guards.',
  );
} finally {
  if (workspaces.length) {
    const ids = workspaces
      .map(uuid)
      .map((id) => `'${id}'`)
      .join(',');
    query(`BEGIN;
      SET LOCAL ayra.actor_user_id = '${uuid(users[0])}';
      DELETE FROM approvals WHERE workspace_id IN (${ids});
      DELETE FROM artifacts WHERE workspace_id IN (${ids});
      UPDATE tasks SET current_run_id = NULL, version = version + 1 WHERE workspace_id IN (${ids}) AND current_run_id IS NOT NULL;
      DELETE FROM runs WHERE workspace_id IN (${ids});
      DELETE FROM tasks WHERE workspace_id IN (${ids});
      DELETE FROM conversations WHERE workspace_id IN (${ids});
      DELETE FROM resources WHERE workspace_id IN (${ids});
      DELETE FROM projects WHERE workspace_id IN (${ids});
      DELETE FROM audit_events WHERE workspace_id IN (${ids});
      DELETE FROM outbox_events WHERE workspace_id IN (${ids});
      DELETE FROM workspace_memberships WHERE workspace_id IN (${ids});
      DELETE FROM workspaces WHERE id IN (${ids});
      COMMIT;`);
  }
  if (users.length) {
    const ids = users
      .map(uuid)
      .map((id) => `'${id}'`)
      .join(',');
    query(`DELETE FROM users WHERE id IN (${ids});`);
  }
}
