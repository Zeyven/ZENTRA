-- The Worker resolves a Run after recovery without persisting provider IDs
-- as AYRA authority. This function is server-only and returns no deleted Task.
CREATE FUNCTION ayra.load_task_run(p_run_id uuid)
RETURNS TABLE(task_id uuid, workspace_id uuid, goal text, task_type text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
  SELECT t.id, t.workspace_id, t.goal, t.type
    FROM public.runs r
    JOIN public.tasks t ON t.id = r.task_id AND t.workspace_id = r.workspace_id
   WHERE r.id = p_run_id AND t.current_run_id = r.id
     AND t.deleted_at IS NULL AND t.status = 'QUEUED'
     AND ayra.has_owner_role(r.created_by, r.workspace_id);
$$;
REVOKE ALL ON FUNCTION ayra.load_task_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.load_task_run(uuid) TO application_role;

-- Every stage write is a local ACID transaction. Existing Task state/version
-- triggers validate transitions and atomically append Audit + Outbox records.
CREATE FUNCTION ayra.worker_task_transition(p_run_id uuid, p_status text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  task_row public.tasks%ROWTYPE;
  run_row public.runs%ROWTYPE;
  run_status text;
BEGIN
  IF p_status NOT IN (
    'UNDERSTANDING', 'PLANNING', 'RUNNING', 'VERIFYING',
    'COMPLETED', 'FAILED', 'CANCELED'
  ) THEN
    RAISE EXCEPTION 'Invalid Worker Task stage' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO run_row FROM public.runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  SELECT * INTO task_row FROM public.tasks t
    WHERE t.id = run_row.task_id AND t.workspace_id = run_row.workspace_id
      AND t.current_run_id = p_run_id AND t.deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF task_row.status = p_status THEN RETURN 'UNCHANGED'; END IF;
  IF task_row.status IN ('COMPLETED', 'FAILED', 'CANCELED') THEN RETURN 'CONFLICT'; END IF;
  IF p_status NOT IN ('FAILED', 'CANCELED') AND
     ayra.has_owner_role(run_row.created_by, run_row.workspace_id) IS NOT TRUE THEN
    RETURN 'POLICY_DENIED';
  END IF;
  PERFORM set_config('ayra.actor_user_id', run_row.created_by::text, true);
  UPDATE public.tasks t SET status = p_status, version = t.version + 1,
    updated_by = run_row.created_by WHERE t.id = task_row.id;
  run_status := CASE
    WHEN p_status IN ('COMPLETED', 'FAILED', 'CANCELED') THEN p_status
    ELSE 'RUNNING'
  END;
  IF run_row.status IS DISTINCT FROM run_status THEN
    UPDATE public.runs r SET status = run_status, version = r.version + 1
      WHERE r.id = p_run_id;
  END IF;
  RETURN 'UPDATED';
END;
$$;
REVOKE ALL ON FUNCTION ayra.worker_task_transition(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.worker_task_transition(uuid, text) TO application_role;
