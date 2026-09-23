-- Trusted canonical transition from a Draft Task to one queued execution
-- attempt. It never contacts Temporal inside the database transaction.
CREATE FUNCTION ayra.start_task_attempt(p_task_id uuid, p_expected_version bigint)
RETURNS TABLE(result_code text, run_id uuid, task_version bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  task_row public.tasks%ROWTYPE;
  actor uuid := ayra.current_actor_id();
  candidate_workspace uuid;
  next_attempt bigint;
  new_run_id uuid;
  new_version bigint;
BEGIN
  IF p_task_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Invalid Task start arguments' USING ERRCODE = '22023';
  END IF;
  SELECT t.workspace_id INTO candidate_workspace FROM public.tasks t
    WHERE t.id = p_task_id AND t.deleted_at IS NULL;
  IF candidate_workspace IS NULL OR actor IS NULL OR
     ayra.has_owner_role(actor, candidate_workspace) IS NOT TRUE THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  SELECT * INTO task_row FROM public.tasks t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND OR task_row.deleted_at IS NOT NULL OR
     ayra.has_owner_role(actor, task_row.workspace_id) IS NOT TRUE THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  IF task_row.status <> 'DRAFT' OR task_row.version <> p_expected_version OR
     task_row.current_run_id IS NOT NULL THEN
    RETURN QUERY SELECT 'CONFLICT'::text, NULL::uuid, task_row.version;
    RETURN;
  END IF;
  SELECT COALESCE(MAX(r.attempt), 0) + 1 INTO next_attempt
    FROM public.runs r WHERE r.workspace_id = task_row.workspace_id AND r.task_id = p_task_id;
  INSERT INTO public.runs(workspace_id, task_id, attempt, status, created_by)
    VALUES (task_row.workspace_id, p_task_id, next_attempt, 'PENDING', actor)
    RETURNING id INTO new_run_id;
  UPDATE public.tasks t
     SET status = 'QUEUED', current_run_id = new_run_id,
         version = t.version + 1, updated_by = actor
   WHERE t.id = p_task_id
   RETURNING t.version INTO new_version;
  RETURN QUERY SELECT 'STARTED'::text, new_run_id, new_version;
END;
$$;
REVOKE ALL ON FUNCTION ayra.start_task_attempt(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.start_task_attempt(uuid, bigint) TO application_role;
