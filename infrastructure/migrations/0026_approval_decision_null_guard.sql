-- Harden the callable database boundary independently of HTTP validation.
CREATE OR REPLACE FUNCTION ayra.decide_approval(
  p_approval_id uuid, p_expected_version bigint, p_decision text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  target public.approvals%ROWTYPE;
  task_row public.tasks%ROWTYPE;
  actor uuid := ayra.current_actor_id();
BEGIN
  IF p_approval_id IS NULL OR p_expected_version IS NULL OR
     p_expected_version < 1 OR p_decision IS NULL OR
     p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Invalid Approval decision' USING ERRCODE = '22023';
  END IF;
  IF actor IS NULL THEN RETURN 'NOT_FOUND'; END IF;

  SELECT * INTO target FROM public.approvals WHERE id = p_approval_id;
  IF NOT FOUND OR target.user_id <> actor OR
     ayra.has_active_membership(actor, target.workspace_id) IS NOT TRUE THEN
    RETURN 'NOT_FOUND';
  END IF;
  SELECT * INTO task_row FROM public.tasks
   WHERE id = target.task_id AND workspace_id = target.workspace_id FOR UPDATE;
  SELECT * INTO target FROM public.approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND OR target.user_id <> actor OR
     ayra.has_active_membership(actor, target.workspace_id) IS NOT TRUE THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF target.version IS DISTINCT FROM p_expected_version OR target.status <> 'PENDING' THEN
    RETURN 'CONFLICT';
  END IF;
  IF target.expires_at <= now() THEN
    UPDATE public.approvals SET status = 'EXPIRED', version = version + 1
     WHERE id = target.id;
    RETURN 'EXPIRED';
  END IF;
  IF task_row.id IS NULL OR task_row.deleted_at IS NOT NULL OR
     task_row.current_run_id IS DISTINCT FROM target.run_id OR
     task_row.status <> 'WAITING_APPROVAL' OR
     task_row.version <> target.state_version THEN
    UPDATE public.approvals SET status = 'REVOKED', version = version + 1
     WHERE id = target.id;
    RETURN 'STALE';
  END IF;
  UPDATE public.approvals SET status = p_decision, version = version + 1
   WHERE id = target.id;
  RETURN p_decision;
END;
$$;
