-- M2 canonical Task drafts. Durable execution begins only in M3.
CREATE POLICY tasks_owner_insert ON tasks FOR INSERT TO application_role
  WITH CHECK (
    ayra.has_owner_role(ayra.current_actor_id(), workspace_id)
    AND created_by = ayra.current_actor_id()
    AND status = 'DRAFT'
    AND current_run_id IS NULL
  );
CREATE POLICY tasks_owner_update ON tasks FOR UPDATE TO application_role
  USING (ayra.has_owner_role(ayra.current_actor_id(), workspace_id))
  WITH CHECK (ayra.has_owner_role(ayra.current_actor_id(), workspace_id));
GRANT INSERT ON tasks TO application_role;
GRANT UPDATE (title, goal, version, updated_by, deleted_at) ON tasks TO application_role;

CREATE FUNCTION ayra.task_created_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, NEW.created_by, 'Task', NEW.id, 'task.created.v1');
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Task', NEW.id, 'task.created.v1', NEW.version,
      jsonb_build_object('taskId', NEW.id, 'workspaceId', NEW.workspace_id, 'status', NEW.status));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.task_created_events() FROM PUBLIC;
CREATE TRIGGER tasks_created AFTER INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION ayra.task_created_events();

CREATE FUNCTION ayra.task_updated_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_type text;
BEGIN
  event_type := CASE
    WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'task.deleted.v1'
    WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'task.status_changed.v1'
    ELSE 'task.updated.v1'
  END;
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, ayra.current_actor_id(), 'Task', NEW.id, event_type);
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Task', NEW.id, event_type, NEW.version,
      jsonb_build_object('taskId', NEW.id, 'workspaceId', NEW.workspace_id,
        'status', NEW.status, 'version', NEW.version));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.task_updated_events() FROM PUBLIC;
CREATE TRIGGER tasks_updated AFTER UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION ayra.task_updated_events();
