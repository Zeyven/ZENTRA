CREATE TABLE idempotency_records (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  scope text NOT NULL CHECK (length(scope) BETWEEN 1 AND 120),
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result_ref uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (workspace_id, scope, key)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_records(expires_at);
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_owner_read ON idempotency_records FOR SELECT TO application_role
  USING (ayra.has_owner_role(ayra.current_actor_id(), workspace_id));
CREATE POLICY idempotency_owner_insert ON idempotency_records FOR INSERT TO application_role
  WITH CHECK (ayra.has_owner_role(ayra.current_actor_id(), workspace_id));
CREATE POLICY idempotency_owner_update ON idempotency_records FOR UPDATE TO application_role
  USING (ayra.has_owner_role(ayra.current_actor_id(), workspace_id))
  WITH CHECK (ayra.has_owner_role(ayra.current_actor_id(), workspace_id));
GRANT SELECT, INSERT ON idempotency_records TO application_role;
GRANT UPDATE (result_ref) ON idempotency_records TO application_role;
