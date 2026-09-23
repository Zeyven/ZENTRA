-- Read-only Task projection from the transactional outbox. The version cursor
-- is monotonic per Task even when concurrent transactions commit out of order.
CREATE FUNCTION ayra.read_task_events(
  p_task_id uuid,
  p_after_version bigint,
  p_limit integer
) RETURNS TABLE (
  id uuid,
  event_type text,
  event_version bigint,
  payload jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  task_workspace uuid;
BEGIN
  IF p_after_version IS NULL OR p_after_version < 0 OR
     p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Invalid Task event cursor or limit' USING ERRCODE = '22023';
  END IF;
  SELECT t.workspace_id INTO task_workspace
    FROM public.tasks t WHERE t.id = p_task_id AND t.deleted_at IS NULL;
  IF task_workspace IS NULL OR
     ayra.has_active_membership(ayra.current_actor_id(), task_workspace) IS NOT TRUE THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT e.id, e.event_type, e.event_version, e.payload, e.created_at
      FROM public.outbox_events e
     WHERE e.workspace_id = task_workspace
       AND e.aggregate_type = 'Task'
       AND e.aggregate_id = p_task_id
       AND e.event_version > p_after_version
     ORDER BY e.event_version ASC
     LIMIT p_limit;
END;
$$;
REVOKE ALL ON FUNCTION ayra.read_task_events(uuid, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.read_task_events(uuid, bigint, integer) TO application_role;
