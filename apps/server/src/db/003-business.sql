-- Reviewed structural baseline; no rows or old identity/credentials are imported.
-- The offline schema owner validates composite foreign keys across tenants during migrations.
-- API login roles never inherit this role and cannot change policies or schema.
ALTER POLICY activation_owner ON merchant_users TO saas_migrator USING(true) WITH CHECK(true);
ALTER POLICY activation_metadata ON merchants TO saas_migrator USING(true) WITH CHECK(true);
CREATE TABLE room_warning_batches(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 response_json TEXT NOT NULL,
 UNIQUE(merchant_id,store_id,request_key),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE room_warnings(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 room_id bigint NOT NULL,
 message TEXT NOT NULL,
 sent_by bigint NOT NULL,
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 created_at integer NOT NULL,
 expires_at integer NOT NULL,
 acknowledged_at integer,
 acknowledged_by bigint,
 cancelled_at integer,
 UNIQUE(merchant_id,store_id,request_key),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE rooms(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 room_no TEXT NOT NULL,
 room_name TEXT,
 room_type TEXT NOT NULL DEFAULT '足浴房',
 capacity integer NOT NULL DEFAULT 2,
 status TEXT NOT NULL DEFAULT 'idle',
 sort_order integer NOT NULL DEFAULT 0,
 active integer NOT NULL DEFAULT 1,
 UNIQUE(merchant_id,store_id, room_no),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE technicians(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 code TEXT,
 phone TEXT,
 level TEXT NOT NULL DEFAULT '普通',
 status TEXT NOT NULL DEFAULT 'off',
 base_salary numeric(18,2) NOT NULL DEFAULT 0,
 commission_rate numeric(18,6) NOT NULL DEFAULT 0,
 wheel_rate numeric(18,6) NOT NULL DEFAULT 0,
 dianzhong_rate numeric(18,6) NOT NULL DEFAULT 0,
 half_rate numeric(18,6) NOT NULL DEFAULT 0,
 dianzhong_bonus numeric(18,2) NOT NULL DEFAULT 0,
 add_time_rate numeric(18,6) NOT NULL DEFAULT 0,
 hire_date TEXT,
 active integer NOT NULL DEFAULT 1,
 queue_position integer NOT NULL DEFAULT 0,
 UNIQUE(merchant_id,store_id, code),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE categories(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 type TEXT NOT NULL,
 sort_order integer NOT NULL DEFAULT 0,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE items(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 category_id bigint,
 type TEXT NOT NULL DEFAULT 'service',
 price numeric(18,2) NOT NULL DEFAULT 0,
 duration integer NOT NULL DEFAULT 0,
 commission numeric(18,2) NOT NULL DEFAULT 0,
 stock integer NOT NULL DEFAULT -1,
 low_stock_threshold integer NOT NULL DEFAULT 10,
 cost numeric(18,2) NOT NULL DEFAULT 0,
 unit TEXT DEFAULT '份',
 active integer NOT NULL DEFAULT 1,
 sold_out integer NOT NULL DEFAULT 0,
 is_primary integer NOT NULL DEFAULT 1,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE members(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 phone TEXT,
 card_no TEXT,
 card_type TEXT NOT NULL DEFAULT 'storage',
 balance numeric(18,2) NOT NULL DEFAULT 0,
 bonus_balance numeric(18,2) NOT NULL DEFAULT 0,
 times_balance integer NOT NULL DEFAULT 0,
 points integer NOT NULL DEFAULT 0,
 discount numeric(18,6) NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'active',
 salesman TEXT,
 tags TEXT,
 expiry TEXT,
 level TEXT NOT NULL DEFAULT '普通会员',
 birthday TEXT,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, card_no),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE orders(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 order_no TEXT NOT NULL,
 room_id bigint,
 wristband_no TEXT,
 customer_name TEXT,
 customer_phone TEXT,
 member_id bigint,
 technician_id bigint,
 status TEXT NOT NULL DEFAULT 'open',
 source TEXT NOT NULL DEFAULT 'room',
 opened_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 closed_at timestamptz,
 cashier_id bigint,
 subtotal numeric(18,2) NOT NULL DEFAULT 0,
 discount numeric(18,2) NOT NULL DEFAULT 0,
 payable numeric(18,2) NOT NULL DEFAULT 0,
 paid numeric(18,2) NOT NULL DEFAULT 0,
 discount_detail TEXT,
 checkout_effects TEXT,
 remark TEXT,
 deposit numeric(18,2) NOT NULL DEFAULT 0,
 deposit_refunded integer NOT NULL DEFAULT 0,
 reservation_id bigint,
 booking_deposit numeric(18,2) NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1,
 UNIQUE(merchant_id,store_id, order_no),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE order_items(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 order_id bigint NOT NULL,
 item_id bigint,
 item_name TEXT NOT NULL,
 item_type TEXT NOT NULL DEFAULT 'service',
 quantity numeric(18,3) NOT NULL DEFAULT 1,
 base_price numeric(18,2) NOT NULL DEFAULT 0,
 price numeric(18,2) NOT NULL DEFAULT 0,
 amount numeric(18,2) NOT NULL DEFAULT 0,
 pricing_detail TEXT,
 technician_id bigint,
 clock_in_at timestamptz,
 clock_out_at timestamptz,
 clock_ready_at timestamptz,
 clock_paused_at timestamptz,
 clock_paused_seconds integer NOT NULL DEFAULT 0,
 duration integer NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'active',
 service_type TEXT,
 add_time_count integer NOT NULL DEFAULT 0,
 add_time_amount numeric(18,2) NOT NULL DEFAULT 0,
 is_gift integer NOT NULL DEFAULT 0,
 is_refund integer NOT NULL DEFAULT 0,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE payments(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 order_id bigint NOT NULL,
 method TEXT NOT NULL,
 amount numeric(18,2) NOT NULL DEFAULT 0,
 voucher_code TEXT,
 source TEXT NOT NULL DEFAULT 'checkout',
 reference_no TEXT,
 reversed_at timestamptz,
 paid_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 cashier_id bigint,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE member_transactions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 member_id bigint,
 type TEXT NOT NULL,
 amount numeric(18,2) NOT NULL DEFAULT 0,
 times integer NOT NULL DEFAULT 0,
 balance_after numeric(18,2) NOT NULL DEFAULT 0,
 remark TEXT,
 order_id bigint,
 operator_id bigint,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE reservations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 customer_name TEXT,
 customer_phone TEXT,
 room_id bigint,
 technician_id bigint,
 reserve_time timestamptz,
 service_item_id bigint,
 duration integer NOT NULL DEFAULT 60,
 public_token TEXT,
 request_key TEXT,
 people integer NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'pending',
 remark TEXT,
 staff_id bigint,
 deposit_required numeric(18,2) NOT NULL DEFAULT 0,
 payment_status TEXT NOT NULL DEFAULT 'not_required',
 payment_expires_at timestamptz,
 refund_status TEXT,
 cancellation_fee numeric(18,2) NOT NULL DEFAULT 0,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id),
 source text NOT NULL DEFAULT 'front_desk',
 deposit numeric(18,2) NOT NULL DEFAULT 0,
 cancelled_at timestamptz
);
CREATE TABLE clock_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 order_item_id bigint NOT NULL,
 user_id bigint NOT NULL,
 action TEXT NOT NULL,
 reason TEXT,
 request_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 before_snapshot TEXT NOT NULL,
 after_snapshot TEXT NOT NULL,
 response_json TEXT NOT NULL,
 resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id,request_key),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE clock_reminders(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 order_item_id bigint NOT NULL,
 expected_end_at timestamptz NOT NULL,
 kind TEXT NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,order_item_id,expected_end_at,kind),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE inventory_movements(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 item_id bigint NOT NULL,
 type TEXT NOT NULL,
 qty integer NOT NULL,
 remark TEXT,
 operator_id bigint,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE inventory_stocktakes(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 remark TEXT,
 cancelled_at timestamptz,
 operator_id bigint,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE attendance(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 technician_id bigint NOT NULL,
 clock_in_at timestamptz,
 clock_out_at timestamptz,
 date TEXT,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE shifts(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 cashier_id bigint,
 start_at timestamptz,
 end_at timestamptz,
 start_cash numeric(18,2) NOT NULL DEFAULT 0,
 total_sales numeric(18,2) NOT NULL DEFAULT 0,
 total_cash numeric(18,2) NOT NULL DEFAULT 0,
 total_wechat numeric(18,2) NOT NULL DEFAULT 0,
 total_alipay numeric(18,2) NOT NULL DEFAULT 0,
 total_card numeric(18,2) NOT NULL DEFAULT 0,
 total_meituan numeric(18,2) NOT NULL DEFAULT 0,
 total_douyin numeric(18,2) NOT NULL DEFAULT 0,
 total_member numeric(18,2) NOT NULL DEFAULT 0,
 total_recharge numeric(18,2) NOT NULL DEFAULT 0,
 total_refund numeric(18,2) NOT NULL DEFAULT 0,
 total_discount numeric(18,2) NOT NULL DEFAULT 0,
 handover_note TEXT,
 status TEXT NOT NULL DEFAULT 'open',
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE maintenance_logs(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 source TEXT NOT NULL,
 level TEXT NOT NULL,
 action TEXT NOT NULL,
 request_id TEXT,
 method TEXT,
 route TEXT,
 status_code integer,
 duration_ms integer,
 store_id bigint NOT NULL,
 user_id bigint,
 detail TEXT,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE operation_logs(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 user_id bigint,
 action TEXT,
 detail TEXT,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE settings(
 store_id bigint NOT NULL,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 key TEXT NOT NULL,
 value TEXT,
 PRIMARY KEY(merchant_id,store_id, key)
);
CREATE TABLE wristbands(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 code TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'idle',
 active integer NOT NULL DEFAULT 1,
 deposit numeric(18,2) NOT NULL DEFAULT 0,
 UNIQUE(merchant_id,store_id, code),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id),
 room_id bigint,
 card_uid text
);
CREATE TABLE order_groups(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 group_no TEXT NOT NULL,
 order_id bigint NOT NULL,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE queue(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 queue_no TEXT NOT NULL,
 customer_name TEXT,
 people integer NOT NULL DEFAULT 1,
 phone TEXT,
 status TEXT NOT NULL DEFAULT 'waiting',
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 called_at timestamptz,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE coupons(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 member_id bigint,
 name TEXT NOT NULL,
 type TEXT NOT NULL DEFAULT 'cash',
 value numeric(18,2) NOT NULL DEFAULT 0,
 min_amount numeric(18,2) NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'unused',
 expire_at timestamptz,
 remark TEXT,
 claim_key TEXT,
 used_order_id bigint,
 used_discount_amount numeric(18,2) NOT NULL DEFAULT 0,
 used_at timestamptz,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE member_levels(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 min_consume numeric(18,2) NOT NULL DEFAULT 0,
 discount numeric(18,6) NOT NULL DEFAULT 1,
 sort_order integer NOT NULL DEFAULT 0,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE recharge_plans(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 amount numeric(18,2) NOT NULL DEFAULT 0,
 gift_amount numeric(18,2) NOT NULL DEFAULT 0,
 active integer NOT NULL DEFAULT 1,
 sort_order integer NOT NULL DEFAULT 0,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE points_log(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 member_id bigint NOT NULL,
 points integer NOT NULL,
 type TEXT NOT NULL DEFAULT 'earn',
 remark TEXT,
 order_id bigint,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE technician_skills(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 technician_id bigint NOT NULL,
 item_id bigint NOT NULL,
 UNIQUE(merchant_id,store_id, technician_id, item_id),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE wine_storage(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 customer_name TEXT,
 phone TEXT,
 item_id bigint,
 item_name TEXT NOT NULL,
 quantity numeric(18,3) NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'stored',
 remark TEXT,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE announcements(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 title TEXT NOT NULL,
 content TEXT,
 active integer NOT NULL DEFAULT 1,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE patrol_log(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 room_id bigint,
 room_name TEXT,
 status TEXT NOT NULL DEFAULT 'normal',
 remark TEXT,
 user_id bigint,
 user_name TEXT,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE swipe_log(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 wristband_no TEXT NOT NULL,
 room_name TEXT,
 order_id bigint,
 action TEXT NOT NULL DEFAULT 'order',
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE commission_rules(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 priority integer NOT NULL DEFAULT 100,
 scope TEXT NOT NULL DEFAULT 'service',
 conditions TEXT NOT NULL DEFAULT '{}',
 action_type TEXT NOT NULL DEFAULT 'rate',
 action_value numeric(18,2) NOT NULL DEFAULT 0,
 stack_mode TEXT NOT NULL DEFAULT 'first',
 effective_from TEXT,
 effective_to TEXT,
 active integer NOT NULL DEFAULT 1,
 created_by bigint,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE payroll_snapshots(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 month TEXT NOT NULL,
 technician_id bigint NOT NULL,
 base_salary numeric(18,2) NOT NULL DEFAULT 0,
 commission numeric(18,2) NOT NULL DEFAULT 0,
 bonus numeric(18,2) NOT NULL DEFAULT 0,
 total_salary numeric(18,2) NOT NULL DEFAULT 0,
 calculation_detail TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'draft',
 created_by bigint,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, month, technician_id),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE approval_requests(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 action_type TEXT NOT NULL,
 target_type TEXT,
 target_id bigint,
 reason TEXT NOT NULL,
 before_snapshot TEXT,
 after_snapshot TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 requested_by bigint,
 reviewed_by bigint,
 review_note TEXT,
 requested_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 reviewed_at timestamptz,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE service_consumables(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 service_item_id bigint NOT NULL,
 product_item_id bigint NOT NULL,
 qty numeric(18,3) NOT NULL CHECK(qty > 0),
 UNIQUE(merchant_id,store_id, service_item_id, product_item_id),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE suppliers(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 contact_name TEXT,
 phone TEXT,
 address TEXT,
 remark TEXT,
 active integer NOT NULL DEFAULT 1,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, name),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE purchase_orders(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 order_no TEXT NOT NULL,
 supplier_id bigint,
 status TEXT NOT NULL DEFAULT 'draft',
 remark TEXT,
 created_by bigint,
 ordered_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 received_at timestamptz,
 UNIQUE(merchant_id,store_id, order_no),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE purchase_order_items(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 purchase_order_id bigint NOT NULL,
 item_id bigint NOT NULL,
 ordered_qty numeric(18,3) NOT NULL CHECK(ordered_qty > 0),
 received_qty numeric(18,3) NOT NULL DEFAULT 0,
 returned_qty numeric(18,3) NOT NULL DEFAULT 0,
 unit_cost numeric(18,2) NOT NULL DEFAULT 0,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE inventory_transfers(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 from_store_id bigint NOT NULL,
 to_store_id bigint NOT NULL,
 transfer_no TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft',
 remark TEXT,
 created_by bigint,
 dispatched_at timestamptz,
 received_at timestamptz,
 UNIQUE(merchant_id,from_store_id, transfer_no),
 UNIQUE(merchant_id,id)
);
CREATE TABLE inventory_transfer_items(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 transfer_id bigint NOT NULL,
 item_id bigint NOT NULL,
 qty numeric(18,3) NOT NULL CHECK(qty > 0),
 UNIQUE(merchant_id,id),
 from_store_id bigint NOT NULL,
 to_store_id bigint NOT NULL,
 target_item_id bigint NOT NULL
);
CREATE TABLE booking_waitlist(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 customer_name TEXT NOT NULL,
 customer_phone TEXT NOT NULL,
 service_item_id bigint,
 technician_id bigint,
 preferred_start timestamptz NOT NULL,
 preferred_end timestamptz,
 people integer NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'waiting',
 source TEXT NOT NULL DEFAULT 'web',
 notified_at timestamptz,
 expires_at timestamptz,
 public_token TEXT,
 offer_token TEXT,
 offered_reservation_id bigint,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE marketing_workflows(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 trigger_type TEXT NOT NULL,
 enabled integer NOT NULL DEFAULT 1,
 delay_days integer NOT NULL DEFAULT 0,
 dormant_days integer NOT NULL DEFAULT 30,
 coupon_name TEXT NOT NULL,
 coupon_value numeric(18,2) NOT NULL DEFAULT 0,
 coupon_min_amount numeric(18,2) NOT NULL DEFAULT 0,
 coupon_expire_days integer NOT NULL DEFAULT 30,
 channel TEXT NOT NULL DEFAULT 'in_app',
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, trigger_type),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE marketing_outbox(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 workflow_id bigint NOT NULL,
 member_id bigint,
 customer_phone TEXT,
 trigger_key TEXT NOT NULL,
 scheduled_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 next_retry_at timestamptz,
 last_error_code TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 coupon_id bigint,
 channel TEXT NOT NULL DEFAULT 'in_app',
 detail TEXT,
 processed_at timestamptz,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,workflow_id, trigger_key),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE channel_connections(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 channel TEXT NOT NULL,
 enabled integer NOT NULL DEFAULT 0,
 webhook_secret TEXT,
 merchant_ref TEXT,
 last_received_at timestamptz,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, channel),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE channel_orders(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 channel TEXT NOT NULL,
 external_order_no TEXT NOT NULL,
 voucher_code TEXT,
 amount numeric(18,2) NOT NULL DEFAULT 0,
 customer_phone TEXT,
 status TEXT NOT NULL DEFAULT 'received',
 payload_json TEXT NOT NULL DEFAULT '{}',
 received_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, channel, external_order_no),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE channel_redemptions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 channel_order_id bigint NOT NULL,
 voucher_code TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_cashier',
 order_id bigint,
 redeemed_at timestamptz,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, voucher_code),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE booking_payment_providers(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 provider TEXT NOT NULL,
 enabled integer NOT NULL DEFAULT 0,
 merchant_ref TEXT,
 webhook_secret TEXT,
 gateway_base_url TEXT,
 mode TEXT NOT NULL DEFAULT 'production',
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, provider),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE booking_payment_orders(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 reservation_id bigint NOT NULL,
 payment_no TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 provider TEXT NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount >= 0),
 status TEXT NOT NULL DEFAULT 'pending',
 provider_order_no TEXT,
 provider_trade_no TEXT,
 checkout_url TEXT,
 applied_order_id bigint,
 expires_at timestamptz NOT NULL,
 paid_at timestamptz,
 closed_at timestamptz,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, payment_no),
 UNIQUE(merchant_id,store_id, idempotency_key),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE booking_refunds(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 reservation_id bigint NOT NULL,
 payment_order_id bigint NOT NULL,
 refund_no TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount >= 0),
 cancellation_fee numeric(18,2) NOT NULL DEFAULT 0,
 reason TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 provider_refund_no TEXT,
 requested_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 refunded_at timestamptz,
 updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, refund_no),
 UNIQUE(merchant_id,store_id, idempotency_key),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE booking_payment_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 provider TEXT NOT NULL,
 event_id TEXT NOT NULL,
 event_type TEXT NOT NULL,
 reference_no TEXT,
 payload_json TEXT NOT NULL DEFAULT '{}',
 processed_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,store_id, provider, event_id),
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
CREATE TABLE pricing_rules(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint NOT NULL,
 name TEXT NOT NULL,
 priority integer NOT NULL DEFAULT 100,
 item_id bigint,
 weekdays TEXT,
 start_time TEXT,
 end_time TEXT,
 effective_from TEXT,
 effective_to TEXT,
 room_type TEXT,
 technician_level TEXT,
 member_level TEXT,
 adjustment_type TEXT NOT NULL DEFAULT 'fixed',
 adjustment_value numeric(18,2) NOT NULL DEFAULT 0,
 stack_mode TEXT NOT NULL DEFAULT 'stack',
 enabled integer NOT NULL DEFAULT 1,
 created_by bigint,
 created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(merchant_id,id),
 UNIQUE(merchant_id,store_id,id)
);
ALTER TABLE room_warning_batches ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE room_warning_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_warning_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON room_warning_batches TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON room_warning_batches TO saas_runtime;
CREATE INDEX room_warning_batches_tenant_store ON room_warning_batches(merchant_id,store_id);
ALTER TABLE room_warnings ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE room_warnings ADD FOREIGN KEY(merchant_id,store_id,room_id) REFERENCES rooms(merchant_id,store_id,id);
ALTER TABLE room_warnings ADD FOREIGN KEY(merchant_id,sent_by) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE room_warnings ADD FOREIGN KEY(merchant_id,acknowledged_by) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE room_warnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_warnings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON room_warnings TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON room_warnings TO saas_runtime;
CREATE INDEX room_warnings_tenant_store ON room_warnings(merchant_id,store_id);
ALTER TABLE rooms ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON rooms TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON rooms TO saas_runtime;
CREATE INDEX rooms_tenant_store ON rooms(merchant_id,store_id);
ALTER TABLE technicians ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE technicians FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON technicians TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON technicians TO saas_runtime;
CREATE INDEX technicians_tenant_store ON technicians(merchant_id,store_id);
ALTER TABLE categories ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON categories TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON categories TO saas_runtime;
CREATE INDEX categories_tenant_store ON categories(merchant_id,store_id);
ALTER TABLE items ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE items ADD FOREIGN KEY(merchant_id,store_id,category_id) REFERENCES categories(merchant_id,store_id,id);
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON items TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON items TO saas_runtime;
CREATE INDEX items_tenant_store ON items(merchant_id,store_id);
ALTER TABLE members ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON members TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON members TO saas_runtime;
CREATE INDEX members_tenant_store ON members(merchant_id,store_id);
ALTER TABLE orders ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE orders ADD FOREIGN KEY(merchant_id,store_id,room_id) REFERENCES rooms(merchant_id,store_id,id);
ALTER TABLE orders ADD FOREIGN KEY(merchant_id,member_id) REFERENCES members(merchant_id,id);
ALTER TABLE orders ADD FOREIGN KEY(merchant_id,store_id,technician_id) REFERENCES technicians(merchant_id,store_id,id);
ALTER TABLE orders ADD FOREIGN KEY(merchant_id,cashier_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE orders ADD FOREIGN KEY(merchant_id,store_id,reservation_id) REFERENCES reservations(merchant_id,store_id,id);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON orders TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON orders TO saas_runtime;
CREATE INDEX orders_tenant_store ON orders(merchant_id,store_id);
ALTER TABLE order_items ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE order_items ADD FOREIGN KEY(merchant_id,store_id,order_id) REFERENCES orders(merchant_id,store_id,id);
ALTER TABLE order_items ADD FOREIGN KEY(merchant_id,store_id,item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE order_items ADD FOREIGN KEY(merchant_id,store_id,technician_id) REFERENCES technicians(merchant_id,store_id,id);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON order_items TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON order_items TO saas_runtime;
CREATE INDEX order_items_tenant_store ON order_items(merchant_id,store_id);
ALTER TABLE payments ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE payments ADD FOREIGN KEY(merchant_id,store_id,order_id) REFERENCES orders(merchant_id,store_id,id);
ALTER TABLE payments ADD FOREIGN KEY(merchant_id,cashier_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON payments TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON payments TO saas_runtime;
CREATE INDEX payments_tenant_store ON payments(merchant_id,store_id);
ALTER TABLE member_transactions ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE member_transactions ADD FOREIGN KEY(merchant_id,member_id) REFERENCES members(merchant_id,id);
ALTER TABLE member_transactions ADD FOREIGN KEY(merchant_id,store_id,order_id) REFERENCES orders(merchant_id,store_id,id);
ALTER TABLE member_transactions ADD FOREIGN KEY(merchant_id,operator_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE member_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON member_transactions TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON member_transactions TO saas_runtime;
CREATE INDEX member_transactions_tenant_store ON member_transactions(merchant_id,store_id);
ALTER TABLE reservations ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE reservations ADD FOREIGN KEY(merchant_id,store_id,room_id) REFERENCES rooms(merchant_id,store_id,id);
ALTER TABLE reservations ADD FOREIGN KEY(merchant_id,store_id,technician_id) REFERENCES technicians(merchant_id,store_id,id);
ALTER TABLE reservations ADD FOREIGN KEY(merchant_id,store_id,service_item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE reservations ADD FOREIGN KEY(merchant_id,staff_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON reservations TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON reservations TO saas_runtime;
CREATE INDEX reservations_tenant_store ON reservations(merchant_id,store_id);
ALTER TABLE clock_events ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE clock_events ADD FOREIGN KEY(merchant_id,store_id,order_item_id) REFERENCES order_items(merchant_id,store_id,id);
ALTER TABLE clock_events ADD FOREIGN KEY(merchant_id,user_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE clock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE clock_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON clock_events TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON clock_events TO saas_runtime;
CREATE INDEX clock_events_tenant_store ON clock_events(merchant_id,store_id);
ALTER TABLE clock_reminders ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE clock_reminders ADD FOREIGN KEY(merchant_id,store_id,order_item_id) REFERENCES order_items(merchant_id,store_id,id);
ALTER TABLE clock_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE clock_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON clock_reminders TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON clock_reminders TO saas_runtime;
CREATE INDEX clock_reminders_tenant_store ON clock_reminders(merchant_id,store_id);
ALTER TABLE inventory_movements ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE inventory_movements ADD FOREIGN KEY(merchant_id,store_id,item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE inventory_movements ADD FOREIGN KEY(merchant_id,operator_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON inventory_movements TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON inventory_movements TO saas_runtime;
CREATE INDEX inventory_movements_tenant_store ON inventory_movements(merchant_id,store_id);
ALTER TABLE inventory_stocktakes ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE inventory_stocktakes ADD FOREIGN KEY(merchant_id,operator_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE inventory_stocktakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stocktakes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON inventory_stocktakes TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON inventory_stocktakes TO saas_runtime;
CREATE INDEX inventory_stocktakes_tenant_store ON inventory_stocktakes(merchant_id,store_id);
ALTER TABLE attendance ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE attendance ADD FOREIGN KEY(merchant_id,store_id,technician_id) REFERENCES technicians(merchant_id,store_id,id);
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON attendance TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON attendance TO saas_runtime;
CREATE INDEX attendance_tenant_store ON attendance(merchant_id,store_id);
ALTER TABLE shifts ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE shifts ADD FOREIGN KEY(merchant_id,cashier_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON shifts TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON shifts TO saas_runtime;
CREATE INDEX shifts_tenant_store ON shifts(merchant_id,store_id);
ALTER TABLE maintenance_logs ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE maintenance_logs ADD FOREIGN KEY(merchant_id,user_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON maintenance_logs TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON maintenance_logs TO saas_runtime;
CREATE INDEX maintenance_logs_tenant_store ON maintenance_logs(merchant_id,store_id);
ALTER TABLE operation_logs ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE operation_logs ADD FOREIGN KEY(merchant_id,user_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE operation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON operation_logs TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON operation_logs TO saas_runtime;
CREATE INDEX operation_logs_tenant_store ON operation_logs(merchant_id,store_id);
ALTER TABLE settings ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON settings TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON settings TO saas_runtime;
CREATE INDEX settings_tenant_store ON settings(merchant_id,store_id);
ALTER TABLE wristbands ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE wristbands ADD FOREIGN KEY(merchant_id,store_id,room_id) REFERENCES rooms(merchant_id,store_id,id);
ALTER TABLE wristbands ENABLE ROW LEVEL SECURITY;
ALTER TABLE wristbands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON wristbands TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON wristbands TO saas_runtime;
CREATE INDEX wristbands_tenant_store ON wristbands(merchant_id,store_id);
ALTER TABLE order_groups ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE order_groups ADD FOREIGN KEY(merchant_id,store_id,order_id) REFERENCES orders(merchant_id,store_id,id);
ALTER TABLE order_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON order_groups TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON order_groups TO saas_runtime;
CREATE INDEX order_groups_tenant_store ON order_groups(merchant_id,store_id);
ALTER TABLE queue ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON queue TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON queue TO saas_runtime;
CREATE INDEX queue_tenant_store ON queue(merchant_id,store_id);
ALTER TABLE coupons ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE coupons ADD FOREIGN KEY(merchant_id,member_id) REFERENCES members(merchant_id,id);
ALTER TABLE coupons ADD FOREIGN KEY(merchant_id,store_id,used_order_id) REFERENCES orders(merchant_id,store_id,id);
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON coupons TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON coupons TO saas_runtime;
CREATE INDEX coupons_tenant_store ON coupons(merchant_id,store_id);
ALTER TABLE member_levels ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE member_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_levels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON member_levels TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON member_levels TO saas_runtime;
CREATE INDEX member_levels_tenant_store ON member_levels(merchant_id,store_id);
ALTER TABLE recharge_plans ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE recharge_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE recharge_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON recharge_plans TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON recharge_plans TO saas_runtime;
CREATE INDEX recharge_plans_tenant_store ON recharge_plans(merchant_id,store_id);
ALTER TABLE points_log ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE points_log ADD FOREIGN KEY(merchant_id,member_id) REFERENCES members(merchant_id,id);
ALTER TABLE points_log ADD FOREIGN KEY(merchant_id,store_id,order_id) REFERENCES orders(merchant_id,store_id,id);
ALTER TABLE points_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON points_log TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON points_log TO saas_runtime;
CREATE INDEX points_log_tenant_store ON points_log(merchant_id,store_id);
ALTER TABLE technician_skills ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE technician_skills ADD FOREIGN KEY(merchant_id,store_id,technician_id) REFERENCES technicians(merchant_id,store_id,id);
ALTER TABLE technician_skills ADD FOREIGN KEY(merchant_id,store_id,item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE technician_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_skills FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON technician_skills TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON technician_skills TO saas_runtime;
CREATE INDEX technician_skills_tenant_store ON technician_skills(merchant_id,store_id);
ALTER TABLE wine_storage ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE wine_storage ADD FOREIGN KEY(merchant_id,store_id,item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE wine_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE wine_storage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON wine_storage TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON wine_storage TO saas_runtime;
CREATE INDEX wine_storage_tenant_store ON wine_storage(merchant_id,store_id);
ALTER TABLE announcements ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON announcements TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON announcements TO saas_runtime;
CREATE INDEX announcements_tenant_store ON announcements(merchant_id,store_id);
ALTER TABLE patrol_log ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE patrol_log ADD FOREIGN KEY(merchant_id,store_id,room_id) REFERENCES rooms(merchant_id,store_id,id);
ALTER TABLE patrol_log ADD FOREIGN KEY(merchant_id,user_id) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE patrol_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE patrol_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON patrol_log TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON patrol_log TO saas_runtime;
CREATE INDEX patrol_log_tenant_store ON patrol_log(merchant_id,store_id);
ALTER TABLE swipe_log ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE swipe_log ADD FOREIGN KEY(merchant_id,store_id,order_id) REFERENCES orders(merchant_id,store_id,id);
ALTER TABLE swipe_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE swipe_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON swipe_log TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON swipe_log TO saas_runtime;
CREATE INDEX swipe_log_tenant_store ON swipe_log(merchant_id,store_id);
ALTER TABLE commission_rules ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE commission_rules ADD FOREIGN KEY(merchant_id,created_by) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON commission_rules TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON commission_rules TO saas_runtime;
CREATE INDEX commission_rules_tenant_store ON commission_rules(merchant_id,store_id);
ALTER TABLE payroll_snapshots ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE payroll_snapshots ADD FOREIGN KEY(merchant_id,store_id,technician_id) REFERENCES technicians(merchant_id,store_id,id);
ALTER TABLE payroll_snapshots ADD FOREIGN KEY(merchant_id,created_by) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE payroll_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON payroll_snapshots TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON payroll_snapshots TO saas_runtime;
CREATE INDEX payroll_snapshots_tenant_store ON payroll_snapshots(merchant_id,store_id);
ALTER TABLE approval_requests ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE approval_requests ADD FOREIGN KEY(merchant_id,requested_by) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE approval_requests ADD FOREIGN KEY(merchant_id,reviewed_by) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON approval_requests TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON approval_requests TO saas_runtime;
CREATE INDEX approval_requests_tenant_store ON approval_requests(merchant_id,store_id);
ALTER TABLE service_consumables ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE service_consumables ADD FOREIGN KEY(merchant_id,store_id,service_item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE service_consumables ADD FOREIGN KEY(merchant_id,store_id,product_item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE service_consumables ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_consumables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON service_consumables TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON service_consumables TO saas_runtime;
CREATE INDEX service_consumables_tenant_store ON service_consumables(merchant_id,store_id);
ALTER TABLE suppliers ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON suppliers TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON suppliers TO saas_runtime;
CREATE INDEX suppliers_tenant_store ON suppliers(merchant_id,store_id);
ALTER TABLE purchase_orders ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE purchase_orders ADD FOREIGN KEY(merchant_id,store_id,supplier_id) REFERENCES suppliers(merchant_id,store_id,id);
ALTER TABLE purchase_orders ADD FOREIGN KEY(merchant_id,created_by) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON purchase_orders TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON purchase_orders TO saas_runtime;
CREATE INDEX purchase_orders_tenant_store ON purchase_orders(merchant_id,store_id);
ALTER TABLE purchase_order_items ADD FOREIGN KEY(merchant_id,store_id,purchase_order_id) REFERENCES purchase_orders(merchant_id,store_id,id);
ALTER TABLE purchase_order_items ADD FOREIGN KEY(merchant_id,store_id,item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE purchase_order_items ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON purchase_order_items TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON purchase_order_items TO saas_runtime;
CREATE INDEX purchase_order_items_tenant_store ON purchase_order_items(merchant_id,store_id);
ALTER TABLE inventory_transfers ADD FOREIGN KEY(merchant_id,from_store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE inventory_transfers ADD FOREIGN KEY(merchant_id,to_store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE inventory_transfers ADD FOREIGN KEY(merchant_id,created_by) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE inventory_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON inventory_transfers TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON inventory_transfers TO saas_runtime;
ALTER TABLE inventory_transfer_items ADD FOREIGN KEY(merchant_id,transfer_id) REFERENCES inventory_transfers(merchant_id,id);
ALTER TABLE inventory_transfer_items ADD FOREIGN KEY(merchant_id,from_store_id,item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE inventory_transfer_items ADD FOREIGN KEY(merchant_id,from_store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE inventory_transfer_items ADD FOREIGN KEY(merchant_id,to_store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE inventory_transfer_items ADD FOREIGN KEY(merchant_id,to_store_id,target_item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE inventory_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transfer_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON inventory_transfer_items TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON inventory_transfer_items TO saas_runtime;
ALTER TABLE booking_waitlist ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE booking_waitlist ADD FOREIGN KEY(merchant_id,store_id,service_item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE booking_waitlist ADD FOREIGN KEY(merchant_id,store_id,technician_id) REFERENCES technicians(merchant_id,store_id,id);
ALTER TABLE booking_waitlist ADD FOREIGN KEY(merchant_id,store_id,offered_reservation_id) REFERENCES reservations(merchant_id,store_id,id);
ALTER TABLE booking_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_waitlist FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON booking_waitlist TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON booking_waitlist TO saas_runtime;
CREATE INDEX booking_waitlist_tenant_store ON booking_waitlist(merchant_id,store_id);
ALTER TABLE marketing_workflows ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE marketing_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_workflows FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON marketing_workflows TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON marketing_workflows TO saas_runtime;
CREATE INDEX marketing_workflows_tenant_store ON marketing_workflows(merchant_id,store_id);
ALTER TABLE marketing_outbox ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE marketing_outbox ADD FOREIGN KEY(merchant_id,store_id,workflow_id) REFERENCES marketing_workflows(merchant_id,store_id,id);
ALTER TABLE marketing_outbox ADD FOREIGN KEY(merchant_id,member_id) REFERENCES members(merchant_id,id);
ALTER TABLE marketing_outbox ADD FOREIGN KEY(merchant_id,store_id,coupon_id) REFERENCES coupons(merchant_id,store_id,id);
ALTER TABLE marketing_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON marketing_outbox TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON marketing_outbox TO saas_runtime;
CREATE INDEX marketing_outbox_tenant_store ON marketing_outbox(merchant_id,store_id);
ALTER TABLE channel_connections ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON channel_connections TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON channel_connections TO saas_runtime;
CREATE INDEX channel_connections_tenant_store ON channel_connections(merchant_id,store_id);
ALTER TABLE channel_orders ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE channel_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON channel_orders TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON channel_orders TO saas_runtime;
CREATE INDEX channel_orders_tenant_store ON channel_orders(merchant_id,store_id);
ALTER TABLE channel_redemptions ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE channel_redemptions ADD FOREIGN KEY(merchant_id,store_id,channel_order_id) REFERENCES channel_orders(merchant_id,store_id,id);
ALTER TABLE channel_redemptions ADD FOREIGN KEY(merchant_id,store_id,order_id) REFERENCES orders(merchant_id,store_id,id);
ALTER TABLE channel_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON channel_redemptions TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON channel_redemptions TO saas_runtime;
CREATE INDEX channel_redemptions_tenant_store ON channel_redemptions(merchant_id,store_id);
ALTER TABLE booking_payment_providers ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE booking_payment_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_payment_providers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON booking_payment_providers TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON booking_payment_providers TO saas_runtime;
CREATE INDEX booking_payment_providers_tenant_store ON booking_payment_providers(merchant_id,store_id);
ALTER TABLE booking_payment_orders ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE booking_payment_orders ADD FOREIGN KEY(merchant_id,store_id,reservation_id) REFERENCES reservations(merchant_id,store_id,id);
ALTER TABLE booking_payment_orders ADD FOREIGN KEY(merchant_id,store_id,applied_order_id) REFERENCES orders(merchant_id,store_id,id);
ALTER TABLE booking_payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_payment_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON booking_payment_orders TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON booking_payment_orders TO saas_runtime;
CREATE INDEX booking_payment_orders_tenant_store ON booking_payment_orders(merchant_id,store_id);
ALTER TABLE booking_refunds ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE booking_refunds ADD FOREIGN KEY(merchant_id,store_id,reservation_id) REFERENCES reservations(merchant_id,store_id,id);
ALTER TABLE booking_refunds ADD FOREIGN KEY(merchant_id,store_id,payment_order_id) REFERENCES booking_payment_orders(merchant_id,store_id,id);
ALTER TABLE booking_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON booking_refunds TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON booking_refunds TO saas_runtime;
CREATE INDEX booking_refunds_tenant_store ON booking_refunds(merchant_id,store_id);
ALTER TABLE booking_payment_events ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE booking_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_payment_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON booking_payment_events TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON booking_payment_events TO saas_runtime;
CREATE INDEX booking_payment_events_tenant_store ON booking_payment_events(merchant_id,store_id);
ALTER TABLE pricing_rules ADD FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id);
ALTER TABLE pricing_rules ADD FOREIGN KEY(merchant_id,store_id,item_id) REFERENCES items(merchant_id,store_id,id);
ALTER TABLE pricing_rules ADD FOREIGN KEY(merchant_id,created_by) REFERENCES merchant_users(merchant_id,id);
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON pricing_rules TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON pricing_rules TO saas_runtime;
CREATE INDEX pricing_rules_tenant_store ON pricing_rules(merchant_id,store_id);
CREATE INDEX idx_room_warnings_store ON room_warnings(merchant_id,store_id,id);
CREATE UNIQUE INDEX idx_reservations_request_key ON reservations(merchant_id,store_id, request_key) WHERE request_key IS NOT NULL;
CREATE INDEX idx_maintenance_created ON maintenance_logs(merchant_id,created_at);
CREATE INDEX idx_maintenance_request ON maintenance_logs(merchant_id,request_id);
CREATE INDEX idx_maintenance_source ON maintenance_logs(merchant_id,source,id);
CREATE UNIQUE INDEX idx_coupons_campaign_claim ON coupons(merchant_id,store_id, member_id, claim_key) WHERE claim_key IS NOT NULL;
CREATE INDEX idx_orders_store ON orders(merchant_id,store_id, status, opened_at);
CREATE INDEX idx_order_items_order ON order_items(merchant_id,order_id);
CREATE INDEX idx_members_store ON members(merchant_id,store_id, phone);
CREATE INDEX idx_items_store ON items(merchant_id,store_id, type);
CREATE INDEX idx_commission_rules_store ON commission_rules(merchant_id,store_id, active, priority);
CREATE INDEX idx_approval_requests_store ON approval_requests(merchant_id,store_id, status, requested_at);
CREATE INDEX idx_service_consumables_service ON service_consumables(merchant_id,store_id, service_item_id);
CREATE UNIQUE INDEX idx_orders_reservation ON orders(merchant_id,store_id, reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX idx_purchase_orders_store ON purchase_orders(merchant_id,store_id, status, ordered_at);
CREATE INDEX idx_booking_waitlist_store_status ON booking_waitlist(merchant_id,store_id, status, preferred_start);
CREATE INDEX idx_marketing_outbox_due ON marketing_outbox(merchant_id,status, scheduled_at);
CREATE INDEX idx_channel_orders_store ON channel_orders(merchant_id,store_id, channel, received_at);
CREATE INDEX idx_booking_payment_orders_status ON booking_payment_orders(merchant_id,store_id, status, expires_at);
CREATE INDEX idx_pricing_rules_store ON pricing_rules(merchant_id,store_id, enabled, priority);
ALTER TABLE staff_store_grants ADD FOREIGN KEY(merchant_id,store_id,technician_id) REFERENCES technicians(merchant_id,store_id,id);
GRANT DELETE ON technician_skills,service_consumables,settings TO saas_runtime;
REVOKE UPDATE ON operation_logs,member_transactions,points_log,inventory_movements,clock_events,booking_payment_events FROM saas_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO saas_runtime;
CREATE UNIQUE INDEX one_live_order_per_room ON orders(merchant_id,store_id,room_id) WHERE status IN ('open','suspended');
CREATE UNIQUE INDEX one_live_shift_per_cashier ON shifts(merchant_id,store_id,cashier_id) WHERE status='open';
CREATE UNIQUE INDEX wristbands_card_identity ON wristbands(merchant_id,store_id,card_uid) WHERE card_uid IS NOT NULL;
