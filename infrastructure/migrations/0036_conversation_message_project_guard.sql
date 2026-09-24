-- Prevent new messages in a Conversation whose linked Project is unavailable.
-- Locking the Project serializes an append against concurrent archive/delete.
CREATE FUNCTION ayra.conversation_message_project_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  linked_project_id uuid;
BEGIN
  SELECT project_id INTO linked_project_id
    FROM public.conversations WHERE id = NEW.conversation_id;
  IF linked_project_id IS NOT NULL THEN
    PERFORM id FROM public.projects
     WHERE id = linked_project_id AND workspace_id = NEW.workspace_id
       AND archived_at IS NULL AND deleted_at IS NULL
     FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked Project is unavailable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.conversation_message_project_guard() FROM PUBLIC;
CREATE TRIGGER conversation_messages_project_guard
  BEFORE INSERT ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION ayra.conversation_message_project_guard();
