-- Artifact is controlled Task-backed output metadata. No public create route is exposed.
CREATE POLICY artifacts_owner_insert ON artifacts FOR INSERT TO application_role
  WITH CHECK (
    ayra.has_owner_role(ayra.current_actor_id(), workspace_id)
    AND created_by = ayra.current_actor_id()
  );
CREATE POLICY artifacts_owner_update ON artifacts FOR UPDATE TO application_role
  USING (ayra.has_owner_role(ayra.current_actor_id(), workspace_id))
  WITH CHECK (ayra.has_owner_role(ayra.current_actor_id(), workspace_id));
GRANT INSERT ON artifacts TO application_role;
GRANT UPDATE (title, version, updated_by, deleted_at) ON artifacts TO application_role;

CREATE FUNCTION ayra.artifact_created_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, NEW.created_by, 'Artifact', NEW.id, 'artifact.created.v1');
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Artifact', NEW.id, 'artifact.created.v1', NEW.version,
      jsonb_build_object('artifactId', NEW.id, 'workspaceId', NEW.workspace_id,
        'taskId', NEW.task_id, 'runId', NEW.run_id, 'version', NEW.version));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.artifact_created_events() FROM PUBLIC;
CREATE TRIGGER artifacts_created AFTER INSERT ON artifacts
  FOR EACH ROW EXECUTE FUNCTION ayra.artifact_created_events();

CREATE FUNCTION ayra.artifact_updated_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_type text;
BEGIN
  event_type := CASE
    WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'artifact.deleted.v1'
    ELSE 'artifact.updated.v1'
  END;
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, ayra.current_actor_id(), 'Artifact', NEW.id, event_type);
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Artifact', NEW.id, event_type, NEW.version,
      jsonb_build_object('artifactId', NEW.id, 'workspaceId', NEW.workspace_id,
        'taskId', NEW.task_id, 'runId', NEW.run_id, 'version', NEW.version));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.artifact_updated_events() FROM PUBLIC;
CREATE TRIGGER artifacts_updated AFTER UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION ayra.artifact_updated_events();
