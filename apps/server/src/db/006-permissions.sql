CREATE TABLE role_permissions(
 merchant_id uuid NOT NULL DEFAULT require_merchant_id(),store_id bigint NOT NULL,role text NOT NULL CHECK(role IN('manager','floor','technician')),
 perm_key text NOT NULL,kind text NOT NULL CHECK(kind IN('page','action')),enabled integer NOT NULL CHECK(enabled IN(0,1)),
 PRIMARY KEY(merchant_id,store_id,role,perm_key,kind),FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id)
);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON role_permissions TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON role_permissions TO saas_runtime;
-- Event contents are append-only; only the resolution timestamp is mutable for pending clock requests.
GRANT UPDATE(resolved_at) ON clock_events TO saas_runtime;
GRANT DELETE ON order_groups TO saas_runtime;
CREATE UNIQUE INDEX order_group_once ON order_groups(merchant_id,order_id);
CREATE UNIQUE INDEX attendance_one_open ON attendance(merchant_id,technician_id) WHERE clock_out_at IS NULL;
