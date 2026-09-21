-- Null preserves existing role-based access; explicit arrays restrict each employee grant.
ALTER TABLE staff_store_grants ADD COLUMN pages text[], ADD COLUMN actions text[];
