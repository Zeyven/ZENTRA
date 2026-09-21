-- Apply only to the independent SaaS database. No legacy data is imported.
ALTER TABLE purchase_orders ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE purchase_orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE purchase_orders ADD COLUMN cancel_reason text;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_status CHECK(status IN('draft','partial','received','cancelled'));
ALTER TABLE purchase_order_items ADD CONSTRAINT purchase_receipt_bounds CHECK(received_qty>=0 AND received_qty<=ordered_qty AND returned_qty>=0 AND returned_qty<=received_qty);
ALTER TABLE inventory_transfers ADD CONSTRAINT transfer_status CHECK(status IN('draft','dispatched','received','cancelled'));
ALTER TABLE inventory_transfers ADD CONSTRAINT different_transfer_stores CHECK(from_store_id<>to_store_id);
