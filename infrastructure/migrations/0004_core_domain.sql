-- AYRA BASELINE v1.0 M2 canonical entities. All tenant references carry workspace_id.
CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (workspace_id, id)
);
CREATE INDEX projects_workspace_idx ON projects(workspace_id, created_at DESC);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  goal text NOT NULL CHECK (length(trim(goal)) > 0),
  type text NOT NULL CHECK (length(type) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'QUEUED', 'UNDERSTANDING', 'PLANNING', 'RUNNING',
    'WAITING_APPROVAL', 'VERIFYING', 'PAUSED', 'BLOCKED',
    'COMPLETED', 'FAILED', 'CANCELED'
  )),
  current_run_id uuid,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id),
  UNIQUE (workspace_id, id)
);
CREATE INDEX tasks_workspace_idx ON tasks(workspace_id, created_at DESC);

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  task_id uuid NOT NULL,
  attempt bigint NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (length(status) BETWEEN 1 AND 80),
  provider_execution_ref text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id),
  UNIQUE (workspace_id, task_id, attempt),
  UNIQUE (workspace_id, task_id, id)
);
ALTER TABLE tasks ADD CONSTRAINT tasks_current_run_fk
  FOREIGN KEY (workspace_id, id, current_run_id) REFERENCES runs(workspace_id, task_id, id);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id),
  UNIQUE (workspace_id, id)
);

CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  source_ref text NOT NULL CHECK (length(source_ref) > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id),
  UNIQUE (workspace_id, id)
);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  task_id uuid NOT NULL,
  run_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  object_ref text NOT NULL CHECK (length(object_ref) > 0),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id),
  FOREIGN KEY (workspace_id, task_id, run_id) REFERENCES runs(workspace_id, task_id, id),
  UNIQUE (workspace_id, id)
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  task_id uuid NOT NULL,
  run_id uuid NOT NULL,
  action text NOT NULL CHECK (length(action) > 0),
  resource_ref text NOT NULL CHECK (length(resource_ref) > 0),
  arguments_hash text NOT NULL CHECK (arguments_hash ~ '^[0-9a-f]{64}$'),
  state_version bigint NOT NULL CHECK (state_version > 0),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'APPROVED', 'CONSUMED', 'REJECTED', 'EXPIRED', 'REVOKED'
  )),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, task_id, run_id) REFERENCES runs(workspace_id, task_id, id),
  UNIQUE (workspace_id, id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_workspace_idx ON audit_events(workspace_id, created_at DESC);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  event_version bigint NOT NULL CHECK (event_version > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
CREATE INDEX outbox_unpublished_idx ON outbox_events(created_at) WHERE published_at IS NULL;

CREATE FUNCTION ayra.enforce_entity_version() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Entity identity and tenant are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Version must advance by exactly one' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_version BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION ayra.enforce_entity_version();
CREATE TRIGGER tasks_version BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION ayra.enforce_entity_version();
CREATE TRIGGER runs_version BEFORE UPDATE ON runs
  FOR EACH ROW EXECUTE FUNCTION ayra.enforce_entity_version();
CREATE TRIGGER conversations_version BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION ayra.enforce_entity_version();
CREATE TRIGGER resources_version BEFORE UPDATE ON resources
  FOR EACH ROW EXECUTE FUNCTION ayra.enforce_entity_version();
CREATE TRIGGER artifacts_version BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION ayra.enforce_entity_version();
CREATE TRIGGER approvals_version BEFORE UPDATE ON approvals
  FOR EACH ROW EXECUTE FUNCTION ayra.enforce_entity_version();

-- RLS is the second boundary; API PolicyEngine must authorize first.
DO $$
DECLARE entity_name text;
BEGIN
  FOREACH entity_name IN ARRAY ARRAY[
    'projects', 'tasks', 'runs', 'conversations', 'resources',
    'artifacts', 'approvals', 'audit_events', 'outbox_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', entity_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', entity_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO application_role USING (ayra.has_active_membership(ayra.current_actor_id(), workspace_id))',
      entity_name || '_member_read', entity_name
    );
  END LOOP;
END;
$$;

CREATE POLICY projects_member_insert ON projects FOR INSERT TO application_role
  WITH CHECK (
    ayra.has_active_membership(ayra.current_actor_id(), workspace_id)
    AND created_by = ayra.current_actor_id()
  );
CREATE POLICY projects_member_update ON projects FOR UPDATE TO application_role
  USING (ayra.has_active_membership(ayra.current_actor_id(), workspace_id))
  WITH CHECK (ayra.has_active_membership(ayra.current_actor_id(), workspace_id));
GRANT SELECT, INSERT ON projects TO application_role;
GRANT UPDATE (name, description, version, updated_by, archived_at, deleted_at) ON projects TO application_role;
GRANT SELECT ON tasks, runs, conversations, resources, artifacts, approvals TO application_role;

-- Audit is append-only. A trusted trigger writes both audit and outbox in the same ACID transaction.
CREATE FUNCTION ayra.project_created_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, NEW.created_by, 'Project', NEW.id, 'project.created');
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Project', NEW.id, 'project.created.v1', 1,
      jsonb_build_object('projectId', NEW.id, 'workspaceId', NEW.workspace_id));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.project_created_events() FROM PUBLIC;
CREATE TRIGGER projects_created AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION ayra.project_created_events();
