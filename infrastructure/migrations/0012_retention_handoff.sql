-- A soft delete creates a durable handoff. No purge runs until policy and workers exist.
CREATE TABLE retention_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('Task', 'Resource', 'Artifact')),
  aggregate_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'PENDING_POLICY'
    CHECK (status IN ('PENDING_POLICY', 'READY', 'PURGING', 'COMPLETED', 'FAILED')),
  policy_ref text,
  scheduled_for timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  UNIQUE (workspace_id, aggregate_type, aggregate_id)
);
CREATE INDEX retention_pending_idx ON retention_requests(status, created_at)
  WHERE status <> 'COMPLETED';
ALTER TABLE retention_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_requests FORCE ROW LEVEL SECURITY;

CREATE FUNCTION ayra.handoff_soft_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  entity_name text;
BEGIN
  entity_name := CASE TG_TABLE_NAME
    WHEN 'tasks' THEN 'Task'
    WHEN 'resources' THEN 'Resource'
    WHEN 'artifacts' THEN 'Artifact'
    ELSE NULL
  END;
  IF entity_name IS NULL THEN
    RAISE EXCEPTION 'Unsupported retention entity';
  END IF;
  INSERT INTO public.retention_requests(
    workspace_id, aggregate_type, aggregate_id, requested_by
  ) VALUES (
    NEW.workspace_id, entity_name, NEW.id, ayra.current_actor_id()
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.handoff_soft_delete() FROM PUBLIC;
CREATE TRIGGER tasks_retention_handoff AFTER UPDATE OF deleted_at ON tasks
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION ayra.handoff_soft_delete();
CREATE TRIGGER resources_retention_handoff AFTER UPDATE OF deleted_at ON resources
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION ayra.handoff_soft_delete();
CREATE TRIGGER artifacts_retention_handoff AFTER UPDATE OF deleted_at ON artifacts
  FOR EACH ROW WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION ayra.handoff_soft_delete();
