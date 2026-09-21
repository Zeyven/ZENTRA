CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE merchants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE,name text NOT NULL,
 member_mode text NOT NULL DEFAULT 'store' CHECK(member_mode IN ('store','merchant')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 membership_mode_locked boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_users(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,username text NOT NULL UNIQUE,
 password text NOT NULL,name text NOT NULL,active boolean NOT NULL DEFAULT true,token_version integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE owner_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,used_at timestamptz,created_by bigint NOT NULL REFERENCES platform_users(id));
CREATE TABLE platform_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,platform_user_id bigint REFERENCES platform_users(id),merchant_id uuid REFERENCES merchants(id),
 action text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE auth_attempts(attempt_key text PRIMARY KEY,failures integer NOT NULL DEFAULT 0,locked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE merchant_users(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT nullif(current_setting('app.merchant_id',true),'')::uuid REFERENCES merchants(id),
 username text NOT NULL,password text NOT NULL,name text NOT NULL,role text NOT NULL DEFAULT 'employee' CHECK(role IN ('owner','employee')),
 active integer NOT NULL DEFAULT 1 CHECK(active IN (0,1)),multi_login integer NOT NULL DEFAULT 1,token_version integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(merchant_id,username),UNIQUE(merchant_id,id));
CREATE TABLE support_grants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),
 platform_user_id bigint NOT NULL REFERENCES platform_users(id),owner_id bigint NOT NULL,
 scope text NOT NULL CHECK(scope IN ('read','configuration')),expires_at timestamptz NOT NULL,revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(merchant_id,owner_id) REFERENCES merchant_users(merchant_id,id));

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO saas_runtime,saas_platform;
GRANT SELECT,INSERT,UPDATE ON merchants,platform_users,owner_invites,platform_audit,auth_attempts,support_grants TO saas_platform;
GRANT DELETE ON auth_attempts TO saas_platform;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO saas_platform;
GRANT SELECT,INSERT,UPDATE,DELETE ON merchant_users TO saas_runtime;
GRANT SELECT ON merchants TO saas_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO saas_runtime;
ALTER TABLE merchant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON merchant_users TO saas_runtime
 USING (merchant_id=nullif(current_setting('app.merchant_id',true),'')::uuid)
 WITH CHECK (merchant_id=nullif(current_setting('app.merchant_id',true),'')::uuid);
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_metadata ON merchants TO saas_runtime USING(id=nullif(current_setting('app.merchant_id',true),'')::uuid);
CREATE POLICY platform_metadata ON merchants TO saas_platform USING(true) WITH CHECK(true);
