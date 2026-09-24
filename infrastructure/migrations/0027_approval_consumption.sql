-- Single-use authorization immediately before a Tool Gateway external action.
-- The caller must reconcile an unknown external result using its own idempotency key.
CREATE FUNCTION ayra.consume_approval(
  p_approval_id uuid, p_run_id uuid, p_action text, p_resource_ref text,
  p_arguments_hash text, p_state_version bigint
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  run_row public.runs%ROWTYPE;
  task_row public.tasks%ROWTYPE;
  approval_row public.approvals%ROWTYPE;
  actor uuid := ayra.current_actor_id();
BEGIN
  IF p_approval_id IS NULL OR p_run_id IS NULL OR
     p_action IS NULL OR p_action = '' OR
     p_resource_ref IS NULL OR p_resource_ref = '' OR
     p_arguments_hash IS NULL OR p_arguments_hash !~ '^[0-9a-f]{64}$' OR
     p_state_version IS NULL OR p_state_version < 1 THEN
    RAISE EXCEPTION 'Invalid Approval binding' USING ERRCODE = '22023';
  END IF;
  IF actor IS NULL THEN RETURN 'INVALID'; END IF;

  -- Match the Run -> Task -> Approval lock order used by Worker transitions.
  SELECT * INTO run_row FROM public.runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR run_row.created_by <> actor OR run_row.status <> 'RUNNING' OR
     ayra.has_owner_role(actor, run_row.workspace_id) IS NOT TRUE THEN
    RETURN 'INVALID';
  END IF;
  SELECT * INTO task_row FROM public.tasks
   WHERE id = run_row.task_id AND workspace_id = run_row.workspace_id FOR UPDATE;
  IF NOT FOUND OR task_row.deleted_at IS NOT NULL OR
     task_row.current_run_id IS DISTINCT FROM p_run_id OR
     task_row.status <> 'WAITING_APPROVAL' OR
     task_row.version <> p_state_version THEN
    RETURN 'INVALID';
  END IF;
  SELECT * INTO approval_row FROM public.approvals
   WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND OR approval_row.workspace_id <> run_row.workspace_id OR
     approval_row.task_id <> task_row.id OR approval_row.run_id <> p_run_id OR
     approval_row.status <> 'APPROVED' OR approval_row.expires_at <= now() OR
     approval_row.action <> p_action OR
     approval_row.resource_ref <> p_resource_ref OR
     approval_row.arguments_hash <> p_arguments_hash OR
     approval_row.state_version <> p_state_version OR
     ayra.has_active_membership(approval_row.user_id, approval_row.workspace_id) IS NOT TRUE THEN
    RETURN 'INVALID';
  END IF;
  UPDATE public.approvals SET status = 'CONSUMED', version = version + 1
   WHERE id = approval_row.id;
  RETURN 'CONSUMED';
END;
$$;
REVOKE ALL ON FUNCTION ayra.consume_approval(uuid, uuid, text, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.consume_approval(uuid, uuid, text, text, text, bigint) TO application_role;

CREATE FUNCTION ayra.approval_consumed_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status <> 'APPROVED' OR NEW.status <> 'CONSUMED' THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, ayra.current_actor_id(), 'Approval', NEW.id, 'approval.consumed.v1');
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Approval', NEW.id, 'approval.consumed.v1', NEW.version,
      jsonb_build_object('approvalId', NEW.id, 'workspaceId', NEW.workspace_id,
        'taskId', NEW.task_id, 'runId', NEW.run_id));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.approval_consumed_events() FROM PUBLIC;
CREATE TRIGGER approvals_consumed AFTER UPDATE OF status ON approvals
  FOR EACH ROW EXECUTE FUNCTION ayra.approval_consumed_events();
