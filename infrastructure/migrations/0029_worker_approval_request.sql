-- A Worker may only open an Approval for its canonical active Run. The Task
-- transition and parameter-bound request commit together, including Audit and
-- Outbox triggers. A stable request key makes Activity retries single-issue.
ALTER TABLE approvals ADD COLUMN request_key text
  CHECK (request_key IS NULL OR length(request_key) BETWEEN 8 AND 128);
CREATE UNIQUE INDEX approvals_run_request_key_idx ON approvals(run_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE FUNCTION ayra.worker_request_approval(
  p_run_id uuid, p_target_user_id uuid, p_action text, p_resource_ref text,
  p_arguments_hash text, p_expires_at timestamptz, p_request_key text
) RETURNS TABLE(result_code text, approval_id uuid, task_version bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  run_row public.runs%ROWTYPE;
  task_row public.tasks%ROWTYPE;
  existing public.approvals%ROWTYPE;
  new_approval_id uuid;
  new_task_version bigint;
BEGIN
  IF p_run_id IS NULL OR p_target_user_id IS NULL OR
     p_action IS NULL OR length(trim(p_action)) NOT BETWEEN 1 AND 120 OR
     p_resource_ref IS NULL OR length(trim(p_resource_ref)) NOT BETWEEN 1 AND 2048 OR
     p_arguments_hash IS NULL OR p_arguments_hash !~ '^[0-9a-f]{64}$' OR
     p_expires_at IS NULL OR p_expires_at <= now() OR
     p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'Invalid Worker Approval request' USING ERRCODE = '22023';
  END IF;

  -- Keep the same Run -> Task -> Approval lock order as consumption.
  SELECT * INTO run_row FROM public.runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR run_row.status <> 'RUNNING' OR
     ayra.has_owner_role(run_row.created_by, run_row.workspace_id) IS NOT TRUE THEN
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  SELECT * INTO task_row FROM public.tasks
   WHERE id = run_row.task_id AND workspace_id = run_row.workspace_id
     AND current_run_id = p_run_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR ayra.has_active_membership(p_target_user_id, run_row.workspace_id) IS NOT TRUE THEN
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO existing FROM public.approvals
   WHERE run_id = p_run_id AND request_key = p_request_key FOR UPDATE;
  IF FOUND THEN
    IF existing.workspace_id = run_row.workspace_id AND
       existing.task_id = task_row.id AND
       existing.user_id = p_target_user_id AND
       existing.action = p_action AND
       existing.resource_ref = p_resource_ref AND
       existing.arguments_hash = p_arguments_hash AND
       existing.expires_at = p_expires_at AND
       existing.status IN ('PENDING', 'APPROVED') AND
       task_row.status = 'WAITING_APPROVAL' AND
       task_row.version = existing.state_version THEN
      RETURN QUERY SELECT 'REPLAY'::text, existing.id, existing.state_version;
    ELSE
      RETURN QUERY SELECT 'CONFLICT'::text, NULL::uuid, NULL::bigint;
    END IF;
    RETURN;
  END IF;
  IF task_row.status <> 'RUNNING' THEN
    RETURN QUERY SELECT 'CONFLICT'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;

  PERFORM set_config('ayra.actor_user_id', run_row.created_by::text, true);
  UPDATE public.tasks SET status = 'WAITING_APPROVAL', version = version + 1,
    updated_by = run_row.created_by WHERE id = task_row.id
    RETURNING version INTO new_task_version;
  INSERT INTO public.approvals(
    workspace_id, user_id, task_id, run_id, action, resource_ref,
    arguments_hash, state_version, expires_at, request_key
  ) VALUES (
    run_row.workspace_id, p_target_user_id, task_row.id, p_run_id,
    p_action, p_resource_ref, p_arguments_hash, new_task_version,
    p_expires_at, p_request_key
  ) RETURNING id INTO new_approval_id;
  RETURN QUERY SELECT 'REQUESTED'::text, new_approval_id, new_task_version;
END;
$$;
REVOKE ALL ON FUNCTION ayra.worker_request_approval(
  uuid, uuid, text, text, text, timestamptz, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.worker_request_approval(
  uuid, uuid, text, text, text, timestamptz, text
) TO application_role;
