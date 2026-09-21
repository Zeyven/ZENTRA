ALTER TABLE pricing_rules ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE commission_rules ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE INDEX shift_entries_reporting ON shift_entries(merchant_id,store_id,created_at,kind);
CREATE INDEX completed_service_reporting ON order_items(merchant_id,store_id,clock_out_at,technician_id) WHERE item_type='service' AND is_refund=0;
CREATE INDEX orders_arrival_reporting ON orders(merchant_id,store_id,opened_at);
CREATE INDEX orders_closed_reporting ON orders(merchant_id,store_id,closed_at) WHERE status='closed';
CREATE TABLE payroll_periods(
 merchant_id uuid NOT NULL DEFAULT require_merchant_id(),store_id bigint NOT NULL,month text NOT NULL CHECK(month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 locked_at timestamptz NOT NULL DEFAULT now(),locked_by bigint NOT NULL,reason text NOT NULL,
 PRIMARY KEY(merchant_id,store_id,month),FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id),FOREIGN KEY(merchant_id,locked_by) REFERENCES merchant_users(merchant_id,id)
);
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON payroll_periods TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT ON payroll_periods TO saas_runtime;
REVOKE UPDATE ON payroll_snapshots FROM saas_runtime;
CREATE TABLE settlement_lines(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id(),store_id bigint NOT NULL,
 entry_id bigint NOT NULL,order_item_id bigint NOT NULL,item_id bigint,item_name text NOT NULL,item_type text NOT NULL,
 quantity numeric(18,3) NOT NULL,gross_amount numeric(18,2) NOT NULL,discount_amount numeric(18,2) NOT NULL,
 standard_commission numeric(18,2) NOT NULL,standard_material numeric(18,2) NOT NULL,
 UNIQUE(merchant_id,entry_id,order_item_id),FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id),
 FOREIGN KEY(merchant_id,store_id,entry_id) REFERENCES shift_entries(merchant_id,store_id,id),
 FOREIGN KEY(merchant_id,store_id,order_item_id) REFERENCES order_items(merchant_id,store_id,id),
 FOREIGN KEY(merchant_id,store_id,item_id) REFERENCES items(merchant_id,store_id,id)
);
ALTER TABLE settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON settlement_lines TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT ON settlement_lines TO saas_runtime;
GRANT USAGE,SELECT ON SEQUENCE settlement_lines_id_seq TO saas_runtime;
