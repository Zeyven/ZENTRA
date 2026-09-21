ALTER TABLE approval_requests ADD COLUMN consumed_at timestamptz;
ALTER TABLE approval_requests ADD CONSTRAINT approvals_status_known CHECK(status IN('pending','approved','rejected','consumed','cancelled'));
ALTER TABLE inventory_movements ADD COLUMN unit_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK(unit_cost>=0);
