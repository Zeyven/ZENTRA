CREATE TABLE idempotency_records(
 merchant_id uuid NOT NULL DEFAULT require_merchant_id(),store_id bigint NOT NULL,route text NOT NULL,request_key text NOT NULL,
 request_hash text NOT NULL,response_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant_id,store_id,route,request_key),FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id)
);
ALTER TABLE members ADD COLUMN scope_store_id bigint;
ALTER TABLE members ADD FOREIGN KEY(merchant_id,scope_store_id) REFERENCES stores(merchant_id,id);
CREATE UNIQUE INDEX member_card_scope ON members(merchant_id,scope_store_id,card_no) NULLS NOT DISTINCT WHERE card_no IS NOT NULL;
ALTER TABLE members ADD CHECK(balance>=0 AND bonus_balance>=0 AND times_balance>=0 AND points>=0);
CREATE TABLE asset_operations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id(),store_id bigint NOT NULL,member_id bigint NOT NULL,
 type text NOT NULL CHECK(type IN('recharge','consume','reverse','adjust','points')),order_id bigint,reversal_of bigint,
 principal numeric(18,2) NOT NULL DEFAULT 0,bonus numeric(18,2) NOT NULL DEFAULT 0,times integer NOT NULL DEFAULT 0,points integer NOT NULL DEFAULT 0,
 operator_id bigint NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_id,id),UNIQUE(merchant_id,member_id,id),UNIQUE(merchant_id,reversal_of),
 FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id),FOREIGN KEY(merchant_id,member_id) REFERENCES members(merchant_id,id),
 FOREIGN KEY(merchant_id,store_id,order_id) REFERENCES orders(merchant_id,store_id,id),FOREIGN KEY(merchant_id,operator_id) REFERENCES merchant_users(merchant_id,id),
 FOREIGN KEY(merchant_id,member_id,reversal_of) REFERENCES asset_operations(merchant_id,member_id,id)
);
CREATE TABLE asset_lots(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id(),member_id bigint NOT NULL,origin_store_id bigint NOT NULL,operation_id bigint NOT NULL,
 principal_original numeric(18,2) NOT NULL DEFAULT 0,bonus_original numeric(18,2) NOT NULL DEFAULT 0,times_original integer NOT NULL DEFAULT 0,points_original integer NOT NULL DEFAULT 0,
 principal_remaining numeric(18,2) NOT NULL DEFAULT 0,bonus_remaining numeric(18,2) NOT NULL DEFAULT 0,times_remaining integer NOT NULL DEFAULT 0,points_remaining integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(merchant_id,id),UNIQUE(merchant_id,member_id,id),UNIQUE(merchant_id,operation_id),
 FOREIGN KEY(merchant_id,member_id) REFERENCES members(merchant_id,id),FOREIGN KEY(merchant_id,origin_store_id) REFERENCES stores(merchant_id,id),
 FOREIGN KEY(merchant_id,member_id,operation_id) REFERENCES asset_operations(merchant_id,member_id,id),
 CHECK(principal_remaining BETWEEN 0 AND principal_original AND bonus_remaining BETWEEN 0 AND bonus_original AND times_remaining BETWEEN 0 AND times_original AND points_remaining BETWEEN 0 AND points_original)
);
CREATE TABLE asset_allocations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id(),member_id bigint NOT NULL,operation_id bigint NOT NULL,lot_id bigint NOT NULL,
 principal numeric(18,2) NOT NULL DEFAULT 0,bonus numeric(18,2) NOT NULL DEFAULT 0,times integer NOT NULL DEFAULT 0,points integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(merchant_id,operation_id,lot_id),
 FOREIGN KEY(merchant_id,member_id,operation_id) REFERENCES asset_operations(merchant_id,member_id,id),
 FOREIGN KEY(merchant_id,member_id,lot_id) REFERENCES asset_lots(merchant_id,member_id,id)
);
CREATE INDEX asset_lots_fifo ON asset_lots(merchant_id,member_id,id);
CREATE INDEX asset_operations_member ON asset_operations(merchant_id,member_id,id);
ALTER TABLE member_transactions ADD COLUMN asset_operation_id bigint;
ALTER TABLE member_transactions ADD FOREIGN KEY(merchant_id,member_id,asset_operation_id) REFERENCES asset_operations(merchant_id,member_id,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['idempotency_records','asset_operations','asset_lots','asset_allocations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_rows ON %I TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id())',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO saas_runtime',t);
 END LOOP;
END $$;
GRANT UPDATE(principal_remaining,bonus_remaining,times_remaining,points_remaining) ON asset_lots TO saas_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO saas_runtime;

CREATE FUNCTION lock_membership_mode() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mode text;
BEGIN
 UPDATE public.merchants SET membership_mode_locked=true WHERE id=NEW.merchant_id RETURNING member_mode INTO mode;
 IF TG_TABLE_NAME='members' THEN NEW.scope_store_id:=CASE WHEN mode='store' THEN NEW.store_id ELSE NULL END; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION lock_membership_mode() FROM PUBLIC;
CREATE TRIGGER member_locks_mode BEFORE INSERT ON members FOR EACH ROW EXECUTE FUNCTION lock_membership_mode();
CREATE TRIGGER order_locks_mode BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION lock_membership_mode();
CREATE FUNCTION prevent_member_mode_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD.membership_mode_locked AND (NEW.member_mode<>OLD.member_mode OR NOT NEW.membership_mode_locked) THEN RAISE EXCEPTION 'Member mode is locked' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER membership_mode_frozen BEFORE UPDATE ON merchants FOR EACH ROW EXECUTE FUNCTION prevent_member_mode_change();
GRANT UPDATE(name,member_mode) ON merchants TO saas_runtime;

CREATE FUNCTION enforce_member_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE home_store bigint; mode text;
BEGIN
 IF NEW.member_id IS NULL THEN RETURN NEW; END IF;
 SELECT m.store_id,tenant.member_mode INTO home_store,mode FROM members m JOIN merchants tenant ON tenant.id=m.merchant_id WHERE m.merchant_id=NEW.merchant_id AND m.id=NEW.member_id;
 IF mode IS NULL OR (mode='store' AND home_store<>NEW.store_id) THEN RAISE EXCEPTION 'Member not available in this store' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['orders','member_transactions','coupons','points_log','marketing_outbox','asset_operations'] LOOP
  EXECUTE format('CREATE TRIGGER member_store_boundary BEFORE INSERT OR UPDATE OF member_id,store_id ON %I FOR EACH ROW EXECUTE FUNCTION enforce_member_scope()',t);
 END LOOP;
END $$;
