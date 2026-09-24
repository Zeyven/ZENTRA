-- Cancellation is canonical before any Temporal signal. A queued Run cannot
-- be dispatched after this transaction commits; an active Worker must still
-- receive a durable cancellation signal from the Outbox in a later step.
CREATE FUNCTION ayra.cancel_task_attempt(p_task_id uuid, p_expected_version bigint)
RETURNS TABLE(result_code text, run_id uuid, task_version bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  actor uuid := ayra.current_actor_id();
  candidate_workspace uuid;
  candidate_run_id uuid;
  task_row public.tasks%ROWTYPE;
  run_row public.runs%ROWTYPE;
  next_version bigint;
BEGIN
  IF p_task_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Invalid Task cancel arguments' USING ERRCODE = '22023';
  END IF;
  SELECT t.workspace_id, t.current_run_id
    INTO candidate_workspace, candidate_run_id
    FROM public.tasks t WHERE t.id = p_task_id AND t.deleted_at IS NULL;
  IF candidate_workspace IS NULL OR actor IS NULL OR
     ayra.has_owner_role(actor, candidate_workspace) IS NOT TRUE THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  -- Match the Worker's Run -> Task lock order to avoid deadlocks.
  IF candidate_run_id IS NOT NULL THEN
    SELECT * INTO run_row FROM public.runs r WHERE r.id = candidate_run_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'CONFLICT'::text, NULL::uuid, NULL::bigint;
      RETURN;
    END IF;
  END IF;
  SELECT * INTO task_row FROM public.tasks t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND OR task_row.deleted_at IS NOT NULL OR
     ayra.has_owner_role(actor, task_row.workspace_id) IS NOT TRUE THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  IF task_row.current_run_id IS DISTINCT FROM candidate_run_id OR
     task_row.version <> p_expected_version OR
     task_row.status IN ('COMPLETED', 'FAILED', 'CANCELED') THEN
    RETURN QUERY SELECT 'CONFLICT'::text, task_row.current_run_id, task_row.version;
    RETURN;
  END IF;
  PERFORM set_config('ayra.actor_user_id', actor::text, true);
  UPDATE public.tasks t
     SET status = 'CANCELED', version = t.version + 1, updated_by = actor
   WHERE t.id = p_task_id RETURNING t.version INTO next_version;
  IF candidate_run_id IS NOT NULL AND run_row.status <> 'CANCELED' THEN
    UPDATE public.runs r SET status = 'CANCELED', version = r.version + 1
      WHERE r.id = candidate_run_id;
  END IF;
  RETURN QUERY SELECT 'CANCELED'::text, candidate_run_id, next_version;
END;
$$;
REVOKE ALL ON FUNCTION ayra.cancel_task_attempt(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.cancel_task_attempt(uuid, bigint) TO application_role;
