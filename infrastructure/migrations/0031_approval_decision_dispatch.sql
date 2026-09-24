-- Decision events wake the durable Workflow. The Workflow still reads the
-- canonical database state, so repeated or delayed signals confer no power.
CREATE FUNCTION ayra.claim_approval_decision_events(p_limit integer)
RETURNS TABLE (
  event_id uuid, approval_id uuid, run_id uuid, claim_token uuid, attempts integer
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Invalid Approval decision claim limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH selected AS (
      SELECT e.id FROM public.outbox_events e
       WHERE e.published_at IS NULL
         AND e.event_type IN (
           'approval.approved.v1', 'approval.rejected.v1',
           'approval.expired.v1', 'approval.revoked.v1'
         )
         AND e.payload->>'runId' IS NOT NULL
         AND (e.lease_until IS NULL OR e.lease_until < now())
       ORDER BY e.created_at, e.id FOR UPDATE SKIP LOCKED LIMIT p_limit
    ), claimed AS (
      UPDATE public.outbox_events e
         SET lease_token = uuidv7(), lease_until = now() + interval '30 seconds',
             attempts = e.attempts + 1
        FROM selected s WHERE e.id = s.id
      RETURNING e.id, e.aggregate_id, e.payload, e.lease_token, e.attempts
    )
    SELECT c.id, c.aggregate_id, (c.payload->>'runId')::uuid,
           c.lease_token, c.attempts FROM claimed c;
END;
$$;
REVOKE ALL ON FUNCTION ayra.claim_approval_decision_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.claim_approval_decision_events(integer) TO application_role;

CREATE FUNCTION ayra.approval_decision_dispatch_state(
  p_event_id uuid, p_approval_id uuid, p_run_id uuid
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.outbox_events e JOIN public.approvals a
      ON a.id = p_approval_id AND a.id = e.aggregate_id
     WHERE e.id = p_event_id AND e.event_type IN (
       'approval.approved.v1', 'approval.rejected.v1',
       'approval.expired.v1', 'approval.revoked.v1'
     ) AND a.run_id = p_run_id AND
       e.payload->>'runId' = p_run_id::text AND
       e.payload->>'status' = a.status AND
       e.event_version = a.version
  ) THEN 'READY' ELSE 'STALE' END;
$$;
REVOKE ALL ON FUNCTION ayra.approval_decision_dispatch_state(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.approval_decision_dispatch_state(uuid, uuid, uuid) TO application_role;

CREATE FUNCTION ayra.ack_approval_decision_event(p_event_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.outbox_events SET published_at = now(), lease_token = NULL, lease_until = NULL
   WHERE id = p_event_id AND lease_token = p_claim_token AND published_at IS NULL
     AND event_type IN (
       'approval.approved.v1', 'approval.rejected.v1',
       'approval.expired.v1', 'approval.revoked.v1'
     );
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION ayra.ack_approval_decision_event(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.ack_approval_decision_event(uuid, uuid) TO application_role;
