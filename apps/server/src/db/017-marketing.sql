ALTER TABLE marketing_workflows ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE marketing_workflows ADD CONSTRAINT marketing_workflow_trigger CHECK(trigger_type IN('new_member_no_visit','after_visit','birthday','dormant','member_expiry','booking_cancel'));
ALTER TABLE marketing_workflows ADD CONSTRAINT marketing_workflow_values CHECK(enabled IN(0,1) AND delay_days BETWEEN 0 AND 365 AND dormant_days BETWEEN 7 AND 3650 AND coupon_value>0 AND coupon_min_amount>=0 AND coupon_expire_days BETWEEN 1 AND 365);
ALTER TABLE marketing_outbox ADD CONSTRAINT marketing_outbox_state CHECK(status IN('pending','issued','skipped','failed'));
CREATE INDEX marketing_due ON marketing_outbox(merchant_id,store_id,scheduled_at,id) WHERE status='pending';
CREATE INDEX marketing_member_origin ON members(merchant_id,store_id,id) WHERE status='active';
CREATE INDEX marketing_closed_orders ON orders(merchant_id,store_id,closed_at,member_id) WHERE status='closed';
