-- The Outbox Worker must recheck canonical Task/Run identity after claiming a
-- possibly old event. A canceled/deleted Task must not start execution.
CREATE FUNCTION ayra.task_start_dispatch_state(p_task_id uuid, p_run_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.tasks t
      JOIN public.runs r ON r.id = p_run_id AND r.task_id = t.id
        AND r.workspace_id = t.workspace_id
     WHERE t.id = p_task_id AND t.current_run_id = p_run_id
       AND t.deleted_at IS NULL
       AND t.status NOT IN ('DRAFT', 'COMPLETED', 'FAILED', 'CANCELED')
  ) THEN 'READY' ELSE 'STALE' END;
$$;
REVOKE ALL ON FUNCTION ayra.task_start_dispatch_state(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.task_start_dispatch_state(uuid, uuid) TO application_role;
