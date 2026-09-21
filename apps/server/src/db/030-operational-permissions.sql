-- NULL preserves existing operational access, still bounded by role and pages.
-- An explicit [] means view-only for all operational capabilities.
ALTER TABLE staff_store_grants ADD COLUMN operations text[];
ALTER TABLE staff_store_grants ADD CONSTRAINT staff_operations_limit CHECK (operations IS NULL OR cardinality(operations)<=50);
