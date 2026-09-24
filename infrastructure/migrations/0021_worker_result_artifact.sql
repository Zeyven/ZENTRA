-- One canonical text result per Run. The object key is deterministic and the
-- checksum is checked before a retried Worker can reuse existing metadata.
CREATE UNIQUE INDEX artifacts_one_result_per_run_idx ON artifacts(run_id)
  WHERE run_id IS NOT NULL AND deleted_at IS NULL
    AND provenance->>'kind' = 'RUN_RESULT';

CREATE FUNCTION ayra.worker_result_target(p_run_id uuid)
RETURNS TABLE(workspace_id uuid, task_id uuid, title text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.workspace_id, t.id, t.title
    FROM public.runs r JOIN public.tasks t
      ON t.id = r.task_id AND t.workspace_id = r.workspace_id
   WHERE r.id = p_run_id AND t.current_run_id = r.id
     AND t.status = 'VERIFYING' AND t.deleted_at IS NULL
     AND ayra.has_owner_role(r.created_by, r.workspace_id);
$$;
REVOKE ALL ON FUNCTION ayra.worker_result_target(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.worker_result_target(uuid) TO application_role;

CREATE FUNCTION ayra.worker_register_result_artifact(
  p_run_id uuid, p_object_ref text, p_sha256 text, p_size bigint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  task_row public.tasks%ROWTYPE;
  run_row public.runs%ROWTYPE;
  existing public.artifacts%ROWTYPE;
  created_id uuid;
BEGIN
  IF p_run_id IS NULL OR p_object_ref IS NULL OR length(p_object_ref) < 8 OR
     p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR
     p_size IS NULL OR p_size < 1 OR p_size > 10485760 THEN
    RAISE EXCEPTION 'Invalid result artifact arguments' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run_id::text, 0));
  SELECT * INTO run_row FROM public.runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Result Run missing' USING ERRCODE = '23503'; END IF;
  SELECT * INTO task_row FROM public.tasks t
    WHERE t.id = run_row.task_id AND t.workspace_id = run_row.workspace_id
      AND t.current_run_id = p_run_id AND t.deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND OR task_row.status <> 'VERIFYING' OR
     ayra.has_owner_role(run_row.created_by, run_row.workspace_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Result Task unavailable' USING ERRCODE = '23514';
  END IF;
  IF p_object_ref !~ (
    '^s3://[a-z0-9.-]+/workspaces/' || task_row.workspace_id::text ||
    '/tasks/' || task_row.id::text || '/runs/' || p_run_id::text || '/result[.]txt$'
  ) THEN
    RAISE EXCEPTION 'Result object reference does not match Run identity' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO existing FROM public.artifacts a
    WHERE a.run_id = p_run_id AND a.deleted_at IS NULL
      AND a.provenance->>'kind' = 'RUN_RESULT'
    FOR UPDATE;
  IF FOUND THEN
    IF existing.object_ref = p_object_ref AND
       existing.provenance->>'sha256' = p_sha256 AND
       (existing.provenance->>'size')::bigint = p_size THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION 'Conflicting result artifact for Run' USING ERRCODE = '23505';
  END IF;
  PERFORM set_config('ayra.actor_user_id', run_row.created_by::text, true);
  INSERT INTO public.artifacts(
    workspace_id, task_id, run_id, title, object_ref, provenance, created_by
  ) VALUES (
    task_row.workspace_id, task_row.id, p_run_id,
    left(task_row.title, 233) || ' result', p_object_ref,
    jsonb_build_object('kind', 'RUN_RESULT', 'mimeType', 'text/plain',
      'sha256', p_sha256, 'size', p_size), run_row.created_by
  ) RETURNING id INTO created_id;
  RETURN created_id;
END;
$$;
REVOKE ALL ON FUNCTION ayra.worker_register_result_artifact(uuid, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.worker_register_result_artifact(uuid, text, text, bigint) TO application_role;
