-- A destructive retention request may not leave the unscheduled state without
-- an explicit policy reference and due time. Leases exist only while purging.
ALTER TABLE public.retention_requests ADD CONSTRAINT retention_ready_requires_policy
  CHECK (
    status = 'PENDING_POLICY' OR
    (policy_ref IS NOT NULL AND length(trim(policy_ref)) > 0 AND scheduled_for IS NOT NULL)
  );
ALTER TABLE public.retention_requests ADD CONSTRAINT retention_purging_requires_lease
  CHECK (
    (status = 'PURGING') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  );
