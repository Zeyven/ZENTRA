ALTER TABLE stores ADD COLUMN deleted_at timestamptz, ADD COLUMN management_version integer NOT NULL DEFAULT 0;
ALTER TABLE stores ADD CONSTRAINT deleted_store_inactive CHECK(deleted_at IS NULL OR status=0);
-- Runtime clients cannot enumerate, reopen or overwrite permanently removed stores.
ALTER POLICY tenant_rows ON stores USING(merchant_id=require_merchant_id() AND deleted_at IS NULL) WITH CHECK(merchant_id=require_merchant_id() AND deleted_at IS NULL);
CREATE FUNCTION protect_deleted_store() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Deleted store cannot be changed or restored' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN NEW.management_version=OLD.management_version+1; RETURN NEW; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER stores_permanent_deletion BEFORE UPDATE OR DELETE ON stores FOR EACH ROW EXECUTE FUNCTION protect_deleted_store();
CREATE FUNCTION platform_store_directory(target_merchant uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'name',s.name,'status',s.status,'deleted_at',s.deleted_at,'version',s.management_version,'created_at',s.created_at) ORDER BY s.created_at,s.id),'[]'::jsonb) FROM public.stores s WHERE s.merchant_id=target_merchant
$$;
CREATE FUNCTION platform_manage_store(target_merchant uuid,target_store bigint,operation text,expected_version integer,operator_id bigint,reason text,confirmation_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.stores%ROWTYPE; result jsonb;
BEGIN
 IF operation NOT IN('disable','restore','delete') OR length(trim(reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_users WHERE id=operator_id AND active=true) THEN RAISE EXCEPTION 'Invalid platform operator' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_merchant::text||':restore',0));
 SELECT * INTO s FROM public.stores WHERE merchant_id=target_merchant AND id=target_store FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
 IF s.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('error','STORE_DELETED'); END IF;
 IF s.management_version<>expected_version THEN RETURN jsonb_build_object('error','VERSION_CONFLICT'); END IF;
 IF operation='delete' AND confirmation_code IS DISTINCT FROM s.code THEN RETURN jsonb_build_object('error','CONFIRMATION_REQUIRED'); END IF;
 UPDATE public.stores SET status=CASE WHEN operation='restore' THEN 1 ELSE 0 END,deleted_at=CASE WHEN operation='delete' THEN now() ELSE NULL END WHERE merchant_id=target_merchant AND id=target_store;
 result=jsonb_build_object('id',s.id,'code',s.code,'name',s.name,'operation',operation,'recoverable',operation<>'delete','version',expected_version+1);
 INSERT INTO public.platform_audit(platform_user_id,merchant_id,action,detail) VALUES(operator_id,target_merchant,'store.'||operation,result||jsonb_build_object('previous_status',s.status,'reason',reason,'history_retained',true));
 PERFORM pg_notify('saas_access',jsonb_build_object('merchant_id',target_merchant)::text);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION platform_store_directory(uuid),platform_manage_store(uuid,bigint,text,integer,bigint,text,text),protect_deleted_store() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_store_directory(uuid),platform_manage_store(uuid,bigint,text,integer,bigint,text,text) TO saas_platform;
