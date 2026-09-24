-- A failed Task carries a bounded, non-secret reason that clients can render.
-- Raw Activity/Tool errors must never become a public Task field.
ALTER TABLE public.tasks ADD COLUMN failure_code text
  CHECK (failure_code IS NULL OR failure_code IN (
    'APPROVAL_REJECTED', 'APPROVAL_EXPIRED', 'APPROVAL_STALE',
    'VERIFICATION_FAILED', 'TASK_ACTIVITY_FAILED'
  ));

CREATE FUNCTION ayra.worker_fail_task(p_run_id uuid, p_failure_code text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  run_row public.runs%ROWTYPE;
  task_row public.tasks%ROWTYPE;
BEGIN
  IF p_run_id IS NULL OR p_failure_code IS NULL OR p_failure_code NOT IN (
    'APPROVAL_REJECTED', 'APPROVAL_EXPIRED', 'APPROVAL_STALE',
    'VERIFICATION_FAILED', 'TASK_ACTIVITY_FAILED'
  ) THEN
    RAISE EXCEPTION 'Invalid Worker failure code' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO run_row FROM public.runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  SELECT * INTO task_row FROM public.tasks
   WHERE id = run_row.task_id AND workspace_id = run_row.workspace_id
     AND current_run_id = p_run_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF task_row.status = 'FAILED' AND run_row.status = 'FAILED' AND
     task_row.failure_code = p_failure_code THEN
    RETURN 'UNCHANGED';
  END IF;
  IF task_row.status IN ('COMPLETED', 'FAILED', 'CANCELED') OR
     run_row.status IN ('COMPLETED', 'FAILED', 'CANCELED') THEN
    RETURN 'CONFLICT';
  END IF;
  PERFORM set_config('ayra.actor_user_id', run_row.created_by::text, true);
  UPDATE public.tasks SET status = 'FAILED', failure_code = p_failure_code,
    version = version + 1, updated_by = run_row.created_by WHERE id = task_row.id;
  UPDATE public.runs SET status = 'FAILED', version = version + 1
   WHERE id = run_row.id;
  RETURN 'UPDATED';
END;
$$;
REVOKE ALL ON FUNCTION ayra.worker_fail_task(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.worker_fail_task(uuid, text) TO application_role;

-- Only expose the allowlisted reason on the Task event, not raw exception text.
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
        'currentRunId', NEW.current_run_id, 'failureCode', NEW.failure_code));
  RETURN NEW;
END;
$$;
