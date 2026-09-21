CREATE TABLE merchant_operation_requests(
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),route text NOT NULL,request_key text NOT NULL,request_hash text NOT NULL,response_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant_id,route,request_key)
);
CREATE TABLE merchant_templates(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 type text NOT NULL CHECK(type IN('item','member_level','recharge_plan','coupon')),name text NOT NULL,payload jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_id,id),UNIQUE(merchant_id,id,type),UNIQUE(merchant_id,type,name),CHECK(jsonb_typeof(payload)='object')
);
CREATE TABLE coupon_profiles(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id(),store_id bigint NOT NULL,
 name text NOT NULL,type text NOT NULL CHECK(type IN('cash','discount')),value numeric(18,2) NOT NULL CHECK(value>0),min_amount numeric(18,2) NOT NULL CHECK(min_amount>=0),valid_days integer NOT NULL CHECK(valid_days BETWEEN 1 AND 3650),
 active integer NOT NULL DEFAULT 1 CHECK(active IN(0,1)),UNIQUE(merchant_id,id),UNIQUE(merchant_id,store_id,id),FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id),CHECK(type<>'discount' OR value<=1)
);
CREATE TABLE template_bindings(
 merchant_id uuid NOT NULL DEFAULT require_merchant_id(),store_id bigint NOT NULL,template_id bigint NOT NULL,type text NOT NULL,
 item_id bigint,member_level_id bigint,recharge_plan_id bigint,coupon_profile_id bigint,template_version integer NOT NULL,last_applied jsonb NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant_id,store_id,template_id),FOREIGN KEY(merchant_id,template_id,type) REFERENCES merchant_templates(merchant_id,id,type),FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id),
 FOREIGN KEY(merchant_id,store_id,item_id) REFERENCES items(merchant_id,store_id,id),
 FOREIGN KEY(merchant_id,store_id,member_level_id) REFERENCES member_levels(merchant_id,store_id,id),
 FOREIGN KEY(merchant_id,store_id,recharge_plan_id) REFERENCES recharge_plans(merchant_id,store_id,id),
 FOREIGN KEY(merchant_id,store_id,coupon_profile_id) REFERENCES coupon_profiles(merchant_id,store_id,id),
 CHECK(num_nonnulls(item_id,member_level_id,recharge_plan_id,coupon_profile_id)=1),
 CHECK((type='item' AND item_id IS NOT NULL) OR (type='member_level' AND member_level_id IS NOT NULL) OR (type='recharge_plan' AND recharge_plan_id IS NOT NULL) OR (type='coupon' AND coupon_profile_id IS NOT NULL))
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['merchant_operation_requests','merchant_templates','coupon_profiles','template_bindings'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_rows ON %I TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id())',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON merchant_operation_requests TO saas_runtime;
GRANT SELECT,INSERT,UPDATE ON merchant_templates,coupon_profiles,template_bindings TO saas_runtime;
GRANT USAGE,SELECT ON SEQUENCE merchant_templates_id_seq,coupon_profiles_id_seq TO saas_runtime;
