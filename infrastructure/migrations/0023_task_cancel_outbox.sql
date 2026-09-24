-- A cancellation is dispatched only after its Task + Run transaction commits.
-- Wait for the start event to settle so a missing Workflow is not confused
-- with a start that is still in flight.
CREATE FUNCTION ayra.claim_task_cancel_events(p_limit integer)
RETURNS TABLE (
  event_id uuid,
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
    RAISE EXCEPTION 'Invalid cancellation claim limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH selected AS (
      SELECT e.id FROM public.outbox_events e
       WHERE e.published_at IS NULL
         AND e.event_type = 'task.status_changed.v1'
         AND e.payload->>'status' = 'CANCELED'
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
      RETURNING e.id, e.aggregate_id, e.payload, e.lease_token, e.attempts
    )
    SELECT c.id, c.aggregate_id, (c.payload->>'currentRunId')::uuid,
           c.lease_token, c.attempts FROM claimed c;
END;
$$;
REVOKE ALL ON FUNCTION ayra.claim_task_cancel_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.claim_task_cancel_events(integer) TO application_role;

CREATE FUNCTION ayra.task_cancel_dispatch_state(p_task_id uuid, p_run_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.tasks t JOIN public.runs r
        ON r.id = p_run_id AND r.task_id = t.id AND r.workspace_id = t.workspace_id
       WHERE t.id = p_task_id AND t.current_run_id = p_run_id
         AND t.deleted_at IS NULL AND t.status = 'CANCELED' AND r.status = 'CANCELED'
    ) THEN 'STALE'
    WHEN EXISTS (
      SELECT 1 FROM public.outbox_events e
       WHERE e.aggregate_id = p_task_id AND e.event_type = 'task.status_changed.v1'
         AND e.payload->>'status' = 'QUEUED'
         AND e.payload->>'currentRunId' = p_run_id::text
         AND e.published_at IS NULL
    ) THEN 'WAIT_START'
    ELSE 'READY'
  END;
$$;
REVOKE ALL ON FUNCTION ayra.task_cancel_dispatch_state(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.task_cancel_dispatch_state(uuid, uuid) TO application_role;

CREATE FUNCTION ayra.ack_task_cancel_event(p_event_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.outbox_events
     SET published_at = now(), lease_token = NULL, lease_until = NULL
   WHERE id = p_event_id AND lease_token = p_claim_token
     AND published_at IS NULL AND event_type = 'task.status_changed.v1'
     AND payload->>'status' = 'CANCELED';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION ayra.ack_task_cancel_event(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.ack_task_cancel_event(uuid, uuid) TO application_role;
