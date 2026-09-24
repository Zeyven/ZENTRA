-- Policy remains explicit: only READY requests with a due scheduled_for may run.
-- Leases make object deletion safe to retry after Worker interruption.
ALTER TABLE public.retention_requests ADD COLUMN lease_token uuid;
ALTER TABLE public.retention_requests ADD COLUMN lease_until timestamptz;
ALTER TABLE public.retention_requests ADD COLUMN last_error_code text
  CHECK (last_error_code IS NULL OR last_error_code IN (
    'UNSUPPORTED_OBJECT_REF', 'OBJECT_DELETE_FAILED', 'DATABASE_FINALIZE_FAILED'
  ));

CREATE FUNCTION ayra.claim_due_artifact_purges(p_limit integer)
RETURNS TABLE(
  request_id uuid, workspace_id uuid, artifact_id uuid, task_id uuid,
  run_id uuid, object_ref text, provenance jsonb, claim_token uuid
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Invalid retention claim limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH selected AS (
      SELECT rr.id FROM public.retention_requests rr
       JOIN public.artifacts a ON a.id = rr.aggregate_id
         AND a.workspace_id = rr.workspace_id AND a.deleted_at IS NOT NULL
       WHERE rr.aggregate_type = 'Artifact' AND rr.scheduled_for <= now()
         AND rr.attempts < 5
         AND (rr.status = 'READY' OR
              (rr.status = 'PURGING' AND rr.lease_until < now()))
       ORDER BY rr.scheduled_for, rr.id FOR UPDATE OF rr SKIP LOCKED LIMIT p_limit
    ), claimed AS (
      UPDATE public.retention_requests rr
         SET status = 'PURGING', lease_token = uuidv7(),
             lease_until = now() + interval '60 seconds', attempts = rr.attempts + 1,
             updated_at = now(), last_error_code = NULL
        FROM selected s WHERE rr.id = s.id
      RETURNING rr.id, rr.workspace_id, rr.aggregate_id, rr.lease_token
    )
    SELECT c.id, c.workspace_id, c.aggregate_id, a.task_id, a.run_id,
           a.object_ref, a.provenance, c.lease_token
      FROM claimed c JOIN public.artifacts a ON a.id = c.aggregate_id
       AND a.workspace_id = c.workspace_id;
END;
$$;
REVOKE ALL ON FUNCTION ayra.claim_due_artifact_purges(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.claim_due_artifact_purges(integer) TO application_role;

CREATE FUNCTION ayra.fail_artifact_purge(
  p_request_id uuid, p_token uuid, p_error_code text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_error_code IS NULL OR p_error_code NOT IN (
    'UNSUPPORTED_OBJECT_REF', 'OBJECT_DELETE_FAILED', 'DATABASE_FINALIZE_FAILED'
  ) THEN
    RAISE EXCEPTION 'Invalid purge error code' USING ERRCODE = '22023';
  END IF;
  UPDATE public.retention_requests
     SET status = CASE WHEN attempts >= 5 OR p_error_code = 'UNSUPPORTED_OBJECT_REF'
                       THEN 'FAILED' ELSE 'READY' END,
         lease_token = NULL, lease_until = NULL, updated_at = now(),
         last_error_code = p_error_code
   WHERE id = p_request_id AND aggregate_type = 'Artifact'
     AND status = 'PURGING' AND lease_token = p_token;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION ayra.fail_artifact_purge(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.fail_artifact_purge(uuid, uuid, text) TO application_role;

CREATE FUNCTION ayra.complete_artifact_purge(p_request_id uuid, p_token uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, ayra
AS $$
DECLARE
  request_row public.retention_requests%ROWTYPE;
  artifact_row public.artifacts%ROWTYPE;
BEGIN
  SELECT * INTO request_row FROM public.retention_requests
   WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR p_token IS NULL OR request_row.aggregate_type <> 'Artifact' OR
     request_row.status <> 'PURGING' OR request_row.lease_token IS DISTINCT FROM p_token THEN
    RETURN 'STALE';
  END IF;
  SELECT * INTO artifact_row FROM public.artifacts
   WHERE id = request_row.aggregate_id AND workspace_id = request_row.workspace_id
     AND deleted_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'STALE'; END IF;
  PERFORM set_config('ayra.actor_user_id', request_row.requested_by::text, true);
  DELETE FROM public.artifacts WHERE id = artifact_row.id;
  UPDATE public.retention_requests SET status = 'COMPLETED', completed_at = now(),
    updated_at = now(), lease_token = NULL, lease_until = NULL, last_error_code = NULL
   WHERE id = request_row.id;
  INSERT INTO public.audit_events(
    workspace_id, actor_user_id, aggregate_type, aggregate_id, action
  ) VALUES (
    request_row.workspace_id, request_row.requested_by, 'Artifact', artifact_row.id,
    'artifact.purged.v1'
  );
  INSERT INTO public.outbox_events(
    workspace_id, aggregate_type, aggregate_id, event_type, event_version, payload
  ) VALUES (
    request_row.workspace_id, 'Artifact', artifact_row.id, 'artifact.purged.v1',
    artifact_row.version + 1,
    jsonb_build_object('artifactId', artifact_row.id,
      'workspaceId', request_row.workspace_id, 'retentionRequestId', request_row.id)
  );
  RETURN 'COMPLETED';
END;
$$;
REVOKE ALL ON FUNCTION ayra.complete_artifact_purge(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.complete_artifact_purge(uuid, uuid) TO application_role;
