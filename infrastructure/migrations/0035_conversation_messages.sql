-- Conversation is communication context, not a Task/Artifact source of truth.
-- Message bodies stay in the tenant table; Audit and Outbox contain IDs only.
CREATE TABLE public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  conversation_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  author_kind text NOT NULL CHECK (author_kind IN ('USER', 'ASSISTANT')),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version = 1),
  FOREIGN KEY (workspace_id, conversation_id)
    REFERENCES public.conversations(workspace_id, id),
  UNIQUE (conversation_id, sequence),
  UNIQUE (workspace_id, id)
);
CREATE INDEX conversation_messages_page_idx
  ON public.conversation_messages(conversation_id, sequence);
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_messages_member_read ON public.conversation_messages
  FOR SELECT TO application_role USING (
    ayra.has_active_membership(ayra.current_actor_id(), workspace_id)
  );
GRANT SELECT ON public.conversation_messages TO application_role;

-- The append function serializes sequence allocation under the parent row lock.
-- Only the owner can append a USER message; ASSISTANT is reserved for a later
-- trusted AgentRuntime adapter and has no public write path.
CREATE FUNCTION ayra.append_user_conversation_message(
  p_conversation_id uuid, p_body text
) RETURNS TABLE(result_code text, message_id uuid, message_sequence bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  actor uuid := ayra.current_actor_id();
  conversation_row public.conversations%ROWTYPE;
  next_sequence bigint;
  inserted_id uuid;
BEGIN
  IF p_conversation_id IS NULL OR p_body IS NULL OR
     length(trim(p_body)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'Invalid Conversation message' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO conversation_row FROM public.conversations
   WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND OR actor IS NULL OR
     ayra.has_owner_role(actor, conversation_row.workspace_id) IS NOT TRUE THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  IF conversation_row.archived_at IS NOT NULL THEN
    RETURN QUERY SELECT 'ARCHIVED'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  SELECT coalesce(max(m.sequence), 0) + 1 INTO next_sequence
    FROM public.conversation_messages m WHERE m.conversation_id = p_conversation_id;
  INSERT INTO public.conversation_messages(
    workspace_id, conversation_id, sequence, author_kind, body, created_by
  ) VALUES (
    conversation_row.workspace_id, conversation_row.id, next_sequence,
    'USER', p_body, actor
  ) RETURNING id INTO inserted_id;
  RETURN QUERY SELECT 'CREATED'::text, inserted_id, next_sequence;
END;
$$;
REVOKE ALL ON FUNCTION ayra.append_user_conversation_message(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.append_user_conversation_message(uuid, text) TO application_role;

CREATE FUNCTION ayra.conversation_message_created_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_events(
    workspace_id, actor_user_id, aggregate_type, aggregate_id, action
  ) VALUES (
    NEW.workspace_id, NEW.created_by, 'ConversationMessage', NEW.id,
    'conversation.message_created.v1'
  );
  INSERT INTO public.outbox_events(
    workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload
  ) VALUES (
    NEW.workspace_id, 'ConversationMessage', NEW.id,
    'conversation.message_created.v1', 1,
    jsonb_build_object('messageId', NEW.id, 'conversationId', NEW.conversation_id,
      'workspaceId', NEW.workspace_id, 'sequence', NEW.sequence,
      'authorKind', NEW.author_kind)
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.conversation_message_created_events() FROM PUBLIC;
CREATE TRIGGER conversation_messages_created AFTER INSERT ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION ayra.conversation_message_created_events();
