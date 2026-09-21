DROP INDEX one_live_order_per_room;
CREATE UNIQUE INDEX one_live_order_per_room ON orders(merchant_id,store_id,room_id) WHERE status='open';
DROP INDEX wristband_one_live_order;
CREATE UNIQUE INDEX wristband_one_live_order ON orders(merchant_id,store_id,wristband_no) WHERE wristband_no IS NOT NULL AND status='open';
ALTER TABLE approval_requests ADD COLUMN operation_hash text;
CREATE UNIQUE INDEX approval_pending_operation ON approval_requests(merchant_id,store_id,requested_by,operation_hash) WHERE status IN('pending','approved');
ALTER TABLE asset_operations ADD COLUMN payment_method text;
ALTER TABLE asset_operations ADD COLUMN shift_id bigint;
ALTER TABLE asset_operations ADD FOREIGN KEY(merchant_id,store_id,shift_id) REFERENCES shifts(merchant_id,store_id,id);
CREATE TABLE shift_entries(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id(),store_id bigint NOT NULL,shift_id bigint,
 cashier_id bigint NOT NULL,kind text NOT NULL,method text,amount numeric(18,2) NOT NULL,order_id bigint,asset_operation_id bigint,reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id),
 FOREIGN KEY(merchant_id,store_id,shift_id) REFERENCES shifts(merchant_id,store_id,id),FOREIGN KEY(merchant_id,cashier_id) REFERENCES merchant_users(merchant_id,id),
 FOREIGN KEY(merchant_id,store_id,order_id) REFERENCES orders(merchant_id,store_id,id),FOREIGN KEY(merchant_id,asset_operation_id) REFERENCES asset_operations(merchant_id,id)
);
ALTER TABLE shift_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON shift_entries TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT ON shift_entries TO saas_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO saas_runtime;
