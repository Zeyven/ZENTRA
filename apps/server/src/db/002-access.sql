CREATE FUNCTION require_merchant_id() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE value text := current_setting('app.merchant_id',true);
BEGIN
 IF value IS NULL OR value='' THEN RAISE EXCEPTION 'Tenant context required' USING ERRCODE='42501'; END IF;
 RETURN value::uuid;
END $$;
REVOKE ALL ON FUNCTION require_merchant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION require_merchant_id() TO saas_runtime,saas_platform;
ALTER POLICY tenant_rows ON merchant_users USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
CREATE UNIQUE INDEX merchant_one_owner ON merchant_users(merchant_id) WHERE role='owner';

CREATE TABLE stores(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 code text NOT NULL,name text NOT NULL,short_name text,timezone text NOT NULL DEFAULT 'Asia/Shanghai',currency text NOT NULL DEFAULT 'CNY',
 status integer NOT NULL DEFAULT 1 CHECK(status IN(0,1)),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_id,code),UNIQUE(merchant_id,id)
);
CREATE TABLE staff_store_grants(
 merchant_id uuid NOT NULL DEFAULT require_merchant_id(),user_id bigint NOT NULL,store_id bigint NOT NULL,
 role text NOT NULL CHECK(role IN('manager','floor','technician')),technician_id bigint,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant_id,user_id,store_id),
 FOREIGN KEY(merchant_id,user_id) REFERENCES merchant_users(merchant_id,id),
 FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id),
 CHECK(role!='technician' OR technician_id IS NOT NULL)
);
CREATE TABLE merchant_sessions(
 id uuid PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id(),user_id bigint NOT NULL,
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(merchant_id,user_id) REFERENCES merchant_users(merchant_id,id)
);
CREATE TABLE platform_sessions(id uuid PRIMARY KEY,user_id bigint NOT NULL REFERENCES platform_users(id),
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT,UPDATE ON platform_sessions TO saas_platform;
CREATE TABLE audit_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint,user_id bigint,platform_user_id bigint,support_grant_id uuid,
 action text NOT NULL,object_type text,object_id text,detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id),
 FOREIGN KEY(merchant_id,user_id) REFERENCES merchant_users(merchant_id,id)
);
CREATE TABLE domain_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,merchant_id uuid NOT NULL DEFAULT require_merchant_id() REFERENCES merchants(id),
 store_id bigint,topic text NOT NULL,object_id text,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id)
);
CREATE INDEX domain_events_tenant_cursor ON domain_events(merchant_id,id);
CREATE INDEX merchant_sessions_user ON merchant_sessions(merchant_id,user_id) WHERE revoked_at IS NULL;

DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['stores','staff_store_grants','merchant_sessions','audit_events','domain_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY tenant_rows ON %I TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id())',table_name);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON stores,staff_store_grants,merchant_sessions TO saas_runtime;
GRANT DELETE ON staff_store_grants TO saas_runtime;
GRANT SELECT,INSERT ON audit_events,domain_events TO saas_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO saas_runtime,saas_platform;

ALTER TABLE support_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY support_owner_scope ON support_grants TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
CREATE POLICY support_platform_metadata ON support_grants TO saas_platform USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON support_grants TO saas_runtime;

-- Only this narrow activation function can create the first owner from platform credentials.
-- Its transaction consumes the invite and inserts the owner together. The bearer token is stored hashed.
CREATE POLICY activation_owner ON merchant_users TO saas_migrator USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
CREATE POLICY activation_metadata ON merchants TO saas_migrator USING(id=require_merchant_id());
CREATE FUNCTION activate_owner(invite_hash text,account_name text,password_hash text,display_name text)
 RETURNS TABLE(merchant_id uuid,user_id bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE invitation public.owner_invites%ROWTYPE; owner_user_id bigint; old_context text;
BEGIN
 SELECT * INTO invitation FROM public.owner_invites WHERE token_hash=invite_hash FOR UPDATE;
 IF NOT FOUND OR invitation.used_at IS NOT NULL OR invitation.expires_at<=now() THEN
  RAISE EXCEPTION 'Invitation expired or consumed' USING ERRCODE='22023';
 END IF;
 old_context:=current_setting('app.merchant_id',true);
 PERFORM set_config('app.merchant_id',invitation.merchant_id::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=invitation.merchant_id AND m.status='active') THEN
  RAISE EXCEPTION 'Merchant suspended' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.merchant_users(merchant_id,username,password,name,role)
 VALUES(invitation.merchant_id,account_name,password_hash,display_name,'owner') RETURNING id INTO owner_user_id;
 UPDATE public.owner_invites SET used_at=now() WHERE id=invitation.id;
 INSERT INTO public.platform_audit(merchant_id,action,detail) VALUES(invitation.merchant_id,'owner.activated',jsonb_build_object('user_id',owner_user_id));
 PERFORM set_config('app.merchant_id',coalesce(old_context,''),true);
 RETURN QUERY SELECT invitation.merchant_id,owner_user_id;
END $$;
REVOKE ALL ON FUNCTION activate_owner(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_owner(text,text,text,text) TO saas_platform;

CREATE FUNCTION publish_domain_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('saas_events',json_build_object('merchant_id',NEW.merchant_id,'id',NEW.id)::text); RETURN NEW; END $$;
CREATE TRIGGER domain_event_committed AFTER INSERT ON domain_events FOR EACH ROW EXECUTE FUNCTION publish_domain_event();
