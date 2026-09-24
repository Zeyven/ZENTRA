-- A decision is bound to one active Task/Run state and one named user.
-- Tool execution and Approval consumption remain closed until Tool Gateway exists.
CREATE FUNCTION ayra.decide_approval(
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
  IF p_decision NOT IN ('APPROVED', 'REJECTED') OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'Invalid Approval decision' USING ERRCODE = '22023';
  END IF;
  IF actor IS NULL THEN RETURN 'NOT_FOUND'; END IF;

  -- Lock Task before Approval, matching canonical Task writers' lock order.
  SELECT * INTO target FROM public.approvals WHERE id = p_approval_id;
  IF NOT FOUND OR target.user_id <> actor OR
     ayra.has_active_membership(actor, target.workspace_id) IS NOT TRUE THEN
    RETURN 'NOT_FOUND';
  END IF;
  SELECT * INTO task_row FROM public.tasks
   WHERE id = target.task_id AND workspace_id = target.workspace_id FOR UPDATE;
  SELECT * INTO target FROM public.approvals WHERE id = p_approval_id FOR UPDATE;
  IF target.user_id <> actor OR
     ayra.has_active_membership(actor, target.workspace_id) IS NOT TRUE THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF target.version <> p_expected_version OR target.status <> 'PENDING' THEN
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
REVOKE ALL ON FUNCTION ayra.decide_approval(uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.decide_approval(uuid, bigint, text) TO application_role;

CREATE FUNCTION ayra.approval_decision_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE event_name text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  event_name := CASE NEW.status
    WHEN 'APPROVED' THEN 'approval.approved.v1'
    WHEN 'REJECTED' THEN 'approval.rejected.v1'
    WHEN 'EXPIRED' THEN 'approval.expired.v1'
    WHEN 'REVOKED' THEN 'approval.revoked.v1'
    ELSE NULL
  END;
  IF event_name IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, ayra.current_actor_id(), 'Approval', NEW.id, event_name);
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Approval', NEW.id, event_name, NEW.version,
      jsonb_build_object('approvalId', NEW.id, 'workspaceId', NEW.workspace_id,
        'taskId', NEW.task_id, 'runId', NEW.run_id, 'status', NEW.status));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.approval_decision_events() FROM PUBLIC;
CREATE TRIGGER approvals_decision AFTER UPDATE OF status ON approvals
  FOR EACH ROW EXECUTE FUNCTION ayra.approval_decision_events();
