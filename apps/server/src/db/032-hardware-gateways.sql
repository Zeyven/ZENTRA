CREATE TABLE hardware_gateways (
 id uuid NOT NULL,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name text NOT NULL,
 token_hash text NOT NULL,
 created_by bigint NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 last_seen_at timestamptz,
 device_status jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant_id,id),
 FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(merchant_id,created_by) REFERENCES merchant_users(merchant_id,id) ON DELETE CASCADE
);
CREATE TABLE hardware_bindings (
 merchant_id uuid NOT NULL DEFAULT require_merchant_id(),
 gateway_id uuid NOT NULL,
 room_id bigint NOT NULL,
 device_id text NOT NULL,
 device_ip text NOT NULL,
 PRIMARY KEY(merchant_id,gateway_id,device_id),
 FOREIGN KEY(merchant_id,gateway_id) REFERENCES hardware_gateways(merchant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(merchant_id,room_id) REFERENCES rooms(merchant_id,id) ON DELETE CASCADE
);
ALTER TABLE hardware_gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_gateways FORCE ROW LEVEL SECURITY;
ALTER TABLE hardware_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hardware_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON hardware_gateways TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
CREATE POLICY tenant_rows ON hardware_bindings TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON hardware_gateways TO saas_runtime;
GRANT SELECT,INSERT ON hardware_bindings TO saas_runtime;
