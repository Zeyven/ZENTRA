-- Run is an execution attempt record; creating one does not start a workflow.
CREATE POLICY runs_owner_insert ON runs FOR INSERT TO application_role
  WITH CHECK (
    ayra.has_owner_role(ayra.current_actor_id(), workspace_id)
    AND created_by = ayra.current_actor_id()
  );
CREATE POLICY runs_owner_update ON runs FOR UPDATE TO application_role
  USING (ayra.has_owner_role(ayra.current_actor_id(), workspace_id))
  WITH CHECK (ayra.has_owner_role(ayra.current_actor_id(), workspace_id));
GRANT INSERT ON runs TO application_role;
GRANT UPDATE (status, provider_execution_ref, version) ON runs TO application_role;

CREATE FUNCTION ayra.run_created_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, NEW.created_by, 'Run', NEW.id, 'run.created.v1');
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Run', NEW.id, 'run.created.v1', NEW.version,
      jsonb_build_object('runId', NEW.id, 'taskId', NEW.task_id,
        'workspaceId', NEW.workspace_id, 'attempt', NEW.attempt, 'status', NEW.status));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.run_created_events() FROM PUBLIC;
CREATE TRIGGER runs_created AFTER INSERT ON runs
  FOR EACH ROW EXECUTE FUNCTION ayra.run_created_events();

CREATE FUNCTION ayra.run_updated_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, ayra.current_actor_id(), 'Run', NEW.id, 'run.updated.v1');
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Run', NEW.id, 'run.updated.v1', NEW.version,
      jsonb_build_object('runId', NEW.id, 'taskId', NEW.task_id,
        'workspaceId', NEW.workspace_id, 'attempt', NEW.attempt,
        'status', NEW.status, 'version', NEW.version));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.run_updated_events() FROM PUBLIC;
CREATE TRIGGER runs_updated AFTER UPDATE ON runs
  FOR EACH ROW EXECUTE FUNCTION ayra.run_updated_events();
