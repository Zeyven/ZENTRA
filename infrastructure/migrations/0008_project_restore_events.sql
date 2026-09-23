CREATE OR REPLACE FUNCTION ayra.project_updated_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_type text;
BEGIN
  event_type := CASE
    WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN 'project.archived.v1'
    WHEN OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN 'project.restored.v1'
    ELSE 'project.updated.v1'
  END;
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, ayra.current_actor_id(), 'Project', NEW.id, event_type);
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Project', NEW.id, event_type, NEW.version,
      jsonb_build_object('projectId', NEW.id, 'workspaceId', NEW.workspace_id, 'version', NEW.version));
  RETURN NEW;
END;
$$;
