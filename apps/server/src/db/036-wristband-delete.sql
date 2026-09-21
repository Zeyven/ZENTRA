-- Explicit store-scoped deletion is enforced by the API and existing forced RLS.
-- Historical order wristband numbers remain immutable snapshots, not catalog FKs.
GRANT DELETE ON wristbands TO saas_runtime;
