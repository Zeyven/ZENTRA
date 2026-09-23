-- Pending approvals are controlled records. Decisions and tool execution remain closed until M5.
DROP POLICY approvals_member_read ON approvals;
CREATE POLICY approvals_target_or_owner_read ON approvals FOR SELECT TO application_role
  USING (
    ayra.has_owner_role(ayra.current_actor_id(), workspace_id)
    OR (
      user_id = ayra.current_actor_id()
      AND ayra.has_active_membership(ayra.current_actor_id(), workspace_id)
    )
  );
CREATE POLICY approvals_owner_insert ON approvals FOR INSERT TO application_role
  WITH CHECK (
    ayra.has_owner_role(ayra.current_actor_id(), workspace_id)
    AND ayra.has_active_membership(user_id, workspace_id)
    AND status = 'PENDING'
    AND expires_at > now()
  );
GRANT INSERT ON approvals TO application_role;

CREATE FUNCTION ayra.approval_requested_events() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_events(workspace_id, actor_user_id, aggregate_type, aggregate_id, action)
    VALUES (NEW.workspace_id, ayra.current_actor_id(), 'Approval', NEW.id, 'approval.requested.v1');
  INSERT INTO public.outbox_events(workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload)
    VALUES (NEW.workspace_id, 'Approval', NEW.id, 'approval.requested.v1', NEW.version,
      jsonb_build_object('approvalId', NEW.id, 'workspaceId', NEW.workspace_id,
        'userId', NEW.user_id, 'taskId', NEW.task_id, 'runId', NEW.run_id,
        'stateVersion', NEW.state_version, 'expiresAt', NEW.expires_at));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION ayra.approval_requested_events() FROM PUBLIC;
CREATE TRIGGER approvals_requested AFTER INSERT ON approvals
  FOR EACH ROW EXECUTE FUNCTION ayra.approval_requested_events();
