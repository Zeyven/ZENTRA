CREATE TABLE coupon_campaigns(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),store_id bigint NOT NULL,
 name text NOT NULL,type text NOT NULL CHECK(type IN('cash','discount')),
 value numeric(18,2) NOT NULL CHECK(value>0),min_amount numeric(18,2) NOT NULL CHECK(min_amount>=0),
 expire_days integer NOT NULL CHECK(expire_days BETWEEN 1 AND 365),active boolean NOT NULL DEFAULT false,
 max_claims integer NOT NULL CHECK(max_claims BETWEEN 1 AND 1000000),issued_count integer NOT NULL DEFAULT 0 CHECK(issued_count>=0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_id,id),UNIQUE(merchant_id,store_id,id),
 CHECK(type<>'discount' OR value<=1),CHECK(issued_count<=max_claims),
 FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id)
);
ALTER TABLE coupons ADD COLUMN claim_campaign_id bigint;
ALTER TABLE coupons ADD FOREIGN KEY(merchant_id,store_id,claim_campaign_id) REFERENCES coupon_campaigns(merchant_id,store_id,id);
CREATE UNIQUE INDEX member_campaign_once ON coupons(merchant_id,claim_campaign_id,member_id) WHERE claim_campaign_id IS NOT NULL;
CREATE TABLE coupon_claim_invitations(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),store_id bigint NOT NULL,
 campaign_id bigint NOT NULL,member_id bigint NOT NULL,token_hash text NOT NULL UNIQUE,
 campaign_version integer NOT NULL,expires_at timestamptz NOT NULL,issued_by bigint NOT NULL,
 used_coupon_id bigint,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_id,id),UNIQUE(merchant_id,campaign_id,member_id),
 FOREIGN KEY(merchant_id,store_id,campaign_id) REFERENCES coupon_campaigns(merchant_id,store_id,id),
 FOREIGN KEY(merchant_id,member_id) REFERENCES members(merchant_id,id),
 FOREIGN KEY(merchant_id,issued_by) REFERENCES merchant_users(merchant_id,id),
 FOREIGN KEY(merchant_id,used_coupon_id) REFERENCES coupons(merchant_id,id)
);
ALTER TABLE coupon_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON coupon_campaigns TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
ALTER TABLE coupon_claim_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_claim_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON coupon_claim_invitations TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE ON coupon_campaigns,coupon_claim_invitations TO saas_runtime;
GRANT USAGE,SELECT ON SEQUENCE coupon_campaigns_id_seq,coupon_claim_invitations_id_seq TO saas_runtime;
