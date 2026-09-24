-- Workflow wakeups are hints. The Worker must re-read canonical Approval and
-- Task/Run state before moving past its durable wait.
CREATE FUNCTION ayra.worker_approval_state(
  p_run_id uuid, p_approval_id uuid, p_state_version bigint
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
  SELECT CASE
    WHEN p_state_version IS NULL OR p_state_version < 1 OR
         r.id IS NULL OR t.id IS NULL OR a.id IS NULL OR
         r.status <> 'RUNNING' OR t.deleted_at IS NOT NULL OR
         t.current_run_id IS DISTINCT FROM p_run_id OR
         t.status <> 'WAITING_APPROVAL' OR t.version <> p_state_version OR
         a.state_version <> p_state_version OR
         ayra.has_owner_role(r.created_by, r.workspace_id) IS NOT TRUE OR
         ayra.has_active_membership(a.user_id, a.workspace_id) IS NOT TRUE
      THEN 'STALE'
    WHEN a.status = 'REJECTED' THEN 'REJECTED'
    WHEN a.expires_at <= now() THEN 'EXPIRED'
    WHEN a.status IN ('PENDING', 'APPROVED') THEN a.status
    ELSE 'STALE'
  END
  FROM (SELECT p_run_id AS id) requested
  LEFT JOIN public.runs r ON r.id = requested.id
  LEFT JOIN public.tasks t ON t.id = r.task_id AND t.workspace_id = r.workspace_id
  LEFT JOIN public.approvals a ON a.id = p_approval_id AND
    a.run_id = r.id AND a.task_id = t.id AND a.workspace_id = r.workspace_id;
$$;
REVOKE ALL ON FUNCTION ayra.worker_approval_state(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.worker_approval_state(uuid, uuid, bigint) TO application_role;
