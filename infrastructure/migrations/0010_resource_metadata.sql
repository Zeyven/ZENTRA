-- Resource is user-supplied input metadata, separate from Task-backed Artifact output.
CREATE POLICY resources_owner_insert ON resources FOR INSERT TO application_role
  WITH CHECK (
    ayra.has_owner_role(ayra.current_actor_id(), workspace_id)
    AND created_by = ayra.current_actor_id()
  );
CREATE POLICY resources_owner_update ON resources FOR UPDATE TO application_role
  USING (ayra.has_owner_role(ayra.current_actor_id(), workspace_id))
  WITH CHECK (ayra.has_owner_role(ayra.current_actor_id(), workspace_id));
GRANT INSERT ON resources TO application_role;
GRANT UPDATE (title, version, updated_by, deleted_at) ON resources TO application_role;

CREATE FUNCTION ayra.resource_created_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, NEW.created_by, 'Resource', NEW.id, 'resource.created.v1');
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Resource', NEW.id, 'resource.created.v1', NEW.version,
      jsonb_build_object('resourceId', NEW.id, 'workspaceId', NEW.workspace_id, 'version', NEW.version));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.resource_created_events() FROM PUBLIC;
CREATE TRIGGER resources_created AFTER INSERT ON resources
  FOR EACH ROW EXECUTE FUNCTION ayra.resource_created_events();

CREATE FUNCTION ayra.resource_updated_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_type text;
BEGIN
  event_type := CASE
    WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'resource.deleted.v1'
    ELSE 'resource.updated.v1'
  END;
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, ayra.current_actor_id(), 'Resource', NEW.id, event_type);
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Resource', NEW.id, event_type, NEW.version,
      jsonb_build_object('resourceId', NEW.id, 'workspaceId', NEW.workspace_id, 'version', NEW.version));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.resource_updated_events() FROM PUBLIC;
CREATE TRIGGER resources_updated AFTER UPDATE ON resources
  FOR EACH ROW EXECUTE FUNCTION ayra.resource_updated_events();
