-- Task start is dispatched only after its canonical transaction commits.
-- A lease makes unacknowledged events retryable after a Worker crash.
ALTER TABLE outbox_events ADD COLUMN lease_token uuid;
ALTER TABLE outbox_events ADD COLUMN lease_until timestamptz;
CREATE INDEX outbox_task_start_claim_idx ON outbox_events(created_at, id)
  WHERE published_at IS NULL AND event_type = 'task.status_changed.v1';

-- Include the Run identity in the immutable event snapshot. Other Task event
-- fields retain their existing semantics.
CREATE OR REPLACE FUNCTION ayra.task_updated_events() RETURNS trigger
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
        'status', NEW.status, 'version', NEW.version,
        'currentRunId', NEW.current_run_id));
  RETURN NEW;
END;
$$;

CREATE FUNCTION ayra.claim_task_start_events(p_limit integer)
RETURNS TABLE (
  event_id uuid,
  workspace_id uuid,
  task_id uuid,
  run_id uuid,
  claim_token uuid,
  attempts integer
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Invalid Outbox claim limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH selected AS (
      SELECT e.id FROM public.outbox_events e
       WHERE e.published_at IS NULL
         AND e.event_type = 'task.status_changed.v1'
         AND e.payload->>'status' = 'QUEUED'
         AND e.payload->>'currentRunId' IS NOT NULL
         AND (e.lease_until IS NULL OR e.lease_until < now())
       ORDER BY e.created_at, e.id
       FOR UPDATE SKIP LOCKED
       LIMIT p_limit
    ), claimed AS (
      UPDATE public.outbox_events e
         SET lease_token = uuidv7(), lease_until = now() + interval '30 seconds',
             attempts = e.attempts + 1
        FROM selected s WHERE e.id = s.id
      RETURNING e.id, e.workspace_id, e.aggregate_id, e.payload,
                e.lease_token, e.attempts
    )
    SELECT c.id, c.workspace_id, c.aggregate_id,
           (c.payload->>'currentRunId')::uuid, c.lease_token, c.attempts
      FROM claimed c;
END;
$$;
REVOKE ALL ON FUNCTION ayra.claim_task_start_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.claim_task_start_events(integer) TO application_role;

CREATE FUNCTION ayra.ack_task_start_event(p_event_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.outbox_events
     SET published_at = now(), lease_token = NULL, lease_until = NULL
   WHERE id = p_event_id AND lease_token = p_claim_token
     AND published_at IS NULL AND event_type = 'task.status_changed.v1'
     AND payload->>'status' = 'QUEUED';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION ayra.ack_task_start_event(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.ack_task_start_event(uuid, uuid) TO application_role;
