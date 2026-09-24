-- Task pause/resume is canonical and emits distinct control events. The
-- existing Task trigger keeps the same payload fields for ordinary updates.
CREATE OR REPLACE FUNCTION ayra.task_updated_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  event_type text;
BEGIN
  event_type := CASE
    WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'task.deleted.v1'
    WHEN NEW.status = 'PAUSED' AND OLD.status <> 'PAUSED' THEN 'task.paused.v1'
    WHEN OLD.status = 'PAUSED' AND NEW.status = OLD.resume_status THEN 'task.resumed.v1'
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

-- A Workflow may be created with its first pause signal already applied.
CREATE OR REPLACE FUNCTION ayra.load_task_run(p_run_id uuid)
RETURNS TABLE(task_id uuid, workspace_id uuid, goal text, task_type text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
  SELECT t.id, t.workspace_id, t.goal, t.type
    FROM public.runs r JOIN public.tasks t
      ON t.id = r.task_id AND t.workspace_id = r.workspace_id
   WHERE r.id = p_run_id AND t.current_run_id = r.id
     AND t.deleted_at IS NULL
     AND (t.status = 'QUEUED' OR (t.status = 'PAUSED' AND t.resume_status = 'QUEUED'))
     AND ayra.has_owner_role(r.created_by, r.workspace_id);
$$;

CREATE FUNCTION ayra.pause_task_attempt(p_task_id uuid, p_expected_version bigint)
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
    RAISE EXCEPTION 'Invalid Task pause arguments' USING ERRCODE = '22023';
  END IF;
  SELECT t.workspace_id, t.current_run_id INTO candidate_workspace, candidate_run_id
    FROM public.tasks t WHERE t.id = p_task_id AND t.deleted_at IS NULL;
  IF candidate_workspace IS NULL OR actor IS NULL OR
     ayra.has_owner_role(actor, candidate_workspace) IS NOT TRUE THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  IF candidate_run_id IS NOT NULL THEN
    SELECT * INTO run_row FROM public.runs r WHERE r.id = candidate_run_id FOR UPDATE;
  END IF;
  SELECT * INTO task_row FROM public.tasks t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND OR task_row.deleted_at IS NOT NULL OR
     ayra.has_owner_role(actor, task_row.workspace_id) IS NOT TRUE THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  IF task_row.current_run_id IS DISTINCT FROM candidate_run_id OR
     task_row.version <> p_expected_version OR candidate_run_id IS NULL OR
     task_row.status NOT IN (
       'QUEUED', 'UNDERSTANDING', 'PLANNING', 'RUNNING', 'WAITING_APPROVAL', 'VERIFYING'
     ) THEN
    RETURN QUERY SELECT 'CONFLICT'::text, task_row.current_run_id, task_row.version;
    RETURN;
  END IF;
  PERFORM set_config('ayra.actor_user_id', actor::text, true);
  UPDATE public.tasks t SET status = 'PAUSED', version = t.version + 1,
    updated_by = actor WHERE t.id = p_task_id RETURNING t.version INTO next_version;
  UPDATE public.runs r SET status = 'PAUSED', version = r.version + 1
    WHERE r.id = candidate_run_id;
  RETURN QUERY SELECT 'PAUSED'::text, candidate_run_id, next_version;
END;
$$;
REVOKE ALL ON FUNCTION ayra.pause_task_attempt(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.pause_task_attempt(uuid, bigint) TO application_role;

CREATE FUNCTION ayra.resume_task_attempt(p_task_id uuid, p_expected_version bigint)
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
  next_run_status text;
BEGIN
  IF p_task_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Invalid Task resume arguments' USING ERRCODE = '22023';
  END IF;
  SELECT t.workspace_id, t.current_run_id INTO candidate_workspace, candidate_run_id
    FROM public.tasks t WHERE t.id = p_task_id AND t.deleted_at IS NULL;
  IF candidate_workspace IS NULL OR actor IS NULL OR
     ayra.has_owner_role(actor, candidate_workspace) IS NOT TRUE THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  IF candidate_run_id IS NOT NULL THEN
    SELECT * INTO run_row FROM public.runs r WHERE r.id = candidate_run_id FOR UPDATE;
  END IF;
  SELECT * INTO task_row FROM public.tasks t WHERE t.id = p_task_id FOR UPDATE;
  IF NOT FOUND OR task_row.deleted_at IS NOT NULL OR
     ayra.has_owner_role(actor, task_row.workspace_id) IS NOT TRUE THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  IF task_row.current_run_id IS DISTINCT FROM candidate_run_id OR
     task_row.version <> p_expected_version OR candidate_run_id IS NULL OR
     task_row.status <> 'PAUSED' OR task_row.resume_status IS NULL THEN
    RETURN QUERY SELECT 'CONFLICT'::text, task_row.current_run_id, task_row.version;
    RETURN;
  END IF;
  next_run_status := CASE WHEN task_row.resume_status = 'QUEUED' THEN 'PENDING' ELSE 'RUNNING' END;
  PERFORM set_config('ayra.actor_user_id', actor::text, true);
  UPDATE public.tasks t SET status = task_row.resume_status, version = t.version + 1,
    updated_by = actor WHERE t.id = p_task_id RETURNING t.version INTO next_version;
  UPDATE public.runs r SET status = next_run_status, version = r.version + 1
    WHERE r.id = candidate_run_id;
  RETURN QUERY SELECT 'RESUMED'::text, candidate_run_id, next_version;
END;
$$;
REVOKE ALL ON FUNCTION ayra.resume_task_attempt(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.resume_task_attempt(uuid, bigint) TO application_role;

-- Distinguish a paused start from an ordinary queued start. The dispatcher
-- sends pauseTask atomically with start when this result is returned.
CREATE OR REPLACE FUNCTION ayra.task_start_dispatch_state(p_task_id uuid, p_run_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.tasks t JOIN public.runs r
        ON r.id = p_run_id AND r.task_id = t.id AND r.workspace_id = t.workspace_id
       WHERE t.id = p_task_id AND t.current_run_id = p_run_id
         AND t.deleted_at IS NULL AND t.status = 'PAUSED' AND t.resume_status = 'QUEUED'
    ) THEN 'PAUSED'
    WHEN EXISTS (
      SELECT 1 FROM public.tasks t JOIN public.runs r
        ON r.id = p_run_id AND r.task_id = t.id AND r.workspace_id = t.workspace_id
       WHERE t.id = p_task_id AND t.current_run_id = p_run_id
         AND t.deleted_at IS NULL
         AND t.status NOT IN ('DRAFT', 'COMPLETED', 'FAILED', 'CANCELED', 'PAUSED', 'BLOCKED')
    ) THEN 'READY'
    ELSE 'STALE'
  END;
$$;

CREATE FUNCTION ayra.claim_task_control_events(p_limit integer)
RETURNS TABLE (
  event_id uuid, task_id uuid, run_id uuid, action text,
  claim_token uuid, attempts integer
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Invalid Task control claim limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH selected AS (
      SELECT e.id FROM public.outbox_events e
       WHERE e.published_at IS NULL AND e.event_type IN ('task.paused.v1', 'task.resumed.v1')
         AND e.payload->>'currentRunId' IS NOT NULL
         AND (e.lease_until IS NULL OR e.lease_until < now())
       ORDER BY e.created_at, e.id FOR UPDATE SKIP LOCKED LIMIT p_limit
    ), claimed AS (
      UPDATE public.outbox_events e
         SET lease_token = uuidv7(), lease_until = now() + interval '30 seconds',
             attempts = e.attempts + 1
        FROM selected s WHERE e.id = s.id
      RETURNING e.id, e.aggregate_id, e.event_type, e.payload,
                e.lease_token, e.attempts
    )
    SELECT c.id, c.aggregate_id, (c.payload->>'currentRunId')::uuid,
           CASE WHEN c.event_type = 'task.paused.v1' THEN 'PAUSE' ELSE 'RESUME' END,
           c.lease_token, c.attempts FROM claimed c;
END;
$$;
REVOKE ALL ON FUNCTION ayra.claim_task_control_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.claim_task_control_events(integer) TO application_role;

CREATE FUNCTION ayra.task_control_dispatch_state(p_event_id uuid, p_task_id uuid, p_run_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.tasks t JOIN public.runs r
        ON r.id = p_run_id AND r.task_id = t.id AND r.workspace_id = t.workspace_id
       WHERE t.id = p_task_id AND t.current_run_id = p_run_id AND t.deleted_at IS NULL
         AND t.status NOT IN ('COMPLETED', 'FAILED', 'CANCELED')
    ) THEN 'STALE'
    WHEN EXISTS (
      SELECT 1 FROM public.outbox_events e
       WHERE e.aggregate_id = p_task_id AND e.event_type = 'task.status_changed.v1'
         AND e.payload->>'status' = 'QUEUED'
         AND e.payload->>'currentRunId' = p_run_id::text AND e.published_at IS NULL
    ) THEN 'WAIT_START'
    WHEN EXISTS (
      SELECT 1 FROM public.outbox_events e JOIN public.tasks t ON t.id = p_task_id
       WHERE e.id = p_event_id AND e.aggregate_id = p_task_id
         AND e.event_type = 'task.paused.v1' AND t.status = 'PAUSED'
    ) THEN 'PAUSE'
    WHEN EXISTS (
      SELECT 1 FROM public.outbox_events e JOIN public.tasks t ON t.id = p_task_id
       WHERE e.id = p_event_id AND e.aggregate_id = p_task_id
         AND e.event_type = 'task.resumed.v1'
         AND t.status NOT IN ('PAUSED', 'BLOCKED')
    ) THEN 'RESUME'
    ELSE 'STALE'
  END;
$$;
REVOKE ALL ON FUNCTION ayra.task_control_dispatch_state(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.task_control_dispatch_state(uuid, uuid, uuid) TO application_role;

CREATE FUNCTION ayra.ack_task_control_event(p_event_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.outbox_events SET published_at = now(), lease_token = NULL, lease_until = NULL
   WHERE id = p_event_id AND lease_token = p_claim_token AND published_at IS NULL
     AND event_type IN ('task.paused.v1', 'task.resumed.v1');
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION ayra.ack_task_control_event(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.ack_task_control_event(uuid, uuid) TO application_role;
