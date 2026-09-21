CREATE TABLE maintenance_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint,user_id bigint,
 source text NOT NULL CHECK(source IN('request','system')),
 level text NOT NULL CHECK(level IN('info','warn','error')),
 request_id uuid NOT NULL,method text NOT NULL,route text NOT NULL,
 status_code integer NOT NULL CHECK(status_code BETWEEN 100 AND 599),
 duration_ms integer NOT NULL CHECK(duration_ms>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id),
 FOREIGN KEY(merchant_id,user_id) REFERENCES merchant_users(merchant_id,id)
);
ALTER TABLE maintenance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON maintenance_events TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,DELETE ON maintenance_events TO saas_runtime;
GRANT USAGE,SELECT ON SEQUENCE maintenance_events_id_seq TO saas_runtime;
CREATE INDEX maintenance_events_scope ON maintenance_events(merchant_id,store_id,id DESC);
CREATE INDEX maintenance_events_retention ON maintenance_events(merchant_id,created_at);
