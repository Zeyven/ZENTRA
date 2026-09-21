CREATE TABLE device_connections(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN('receipt_printer','wristband_reader','cash_drawer','customer_display')),
 name text NOT NULL,model text NOT NULL DEFAULT '',
 transport text NOT NULL CHECK(transport IN('system','keyboard','usb','serial','network')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_id,store_id,kind),UNIQUE(merchant_id,id),
 FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id)
);
ALTER TABLE device_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON device_connections TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON device_connections TO saas_runtime;
GRANT USAGE,SELECT ON SEQUENCE device_connections_id_seq TO saas_runtime;
