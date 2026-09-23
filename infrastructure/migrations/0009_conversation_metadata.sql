-- Conversation metadata is a Core Domain entity. Messages and agent execution follow later milestones.
CREATE POLICY conversations_owner_insert ON conversations FOR INSERT TO application_role
  WITH CHECK (
    ayra.has_owner_role(ayra.current_actor_id(), workspace_id)
    AND created_by = ayra.current_actor_id()
  );
CREATE POLICY conversations_owner_update ON conversations FOR UPDATE TO application_role
  USING (ayra.has_owner_role(ayra.current_actor_id(), workspace_id))
  WITH CHECK (ayra.has_owner_role(ayra.current_actor_id(), workspace_id));
GRANT INSERT ON conversations TO application_role;
GRANT UPDATE (title, version, updated_by, archived_at) ON conversations TO application_role;

CREATE FUNCTION ayra.conversation_created_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, NEW.created_by, 'Conversation', NEW.id, 'conversation.created.v1');
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Conversation', NEW.id, 'conversation.created.v1', NEW.version,
      jsonb_build_object('conversationId', NEW.id, 'workspaceId', NEW.workspace_id, 'version', NEW.version));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.conversation_created_events() FROM PUBLIC;
CREATE TRIGGER conversations_created AFTER INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION ayra.conversation_created_events();

CREATE FUNCTION ayra.conversation_updated_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_type text;
BEGIN
  event_type := CASE
    WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN 'conversation.archived.v1'
    WHEN OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN 'conversation.restored.v1'
    ELSE 'conversation.updated.v1'
  END;
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, ayra.current_actor_id(), 'Conversation', NEW.id, event_type);
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Conversation', NEW.id, event_type, NEW.version,
      jsonb_build_object('conversationId', NEW.id, 'workspaceId', NEW.workspace_id, 'version', NEW.version));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.conversation_updated_events() FROM PUBLIC;
CREATE TRIGGER conversations_updated AFTER UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION ayra.conversation_updated_events();
