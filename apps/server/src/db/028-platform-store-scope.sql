-- Definer has no BYPASSRLS: grant only tenant-scoped store maintenance to the DDL owner.
CREATE POLICY tenant_store_maintenance ON stores TO saas_migrator USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
CREATE OR REPLACE FUNCTION platform_store_directory(target_merchant uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; previous_context text:=current_setting('app.merchant_id',true);
BEGIN
 PERFORM set_config('app.merchant_id',target_merchant::text,true);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'name',s.name,'status',s.status,'deleted_at',s.deleted_at,'version',s.management_version,'created_at',s.created_at) ORDER BY s.created_at,s.id),'[]'::jsonb) INTO result FROM public.stores s WHERE s.merchant_id=target_merchant;
 PERFORM set_config('app.merchant_id',coalesce(previous_context,''),true);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION platform_manage_store(target_merchant uuid,target_store bigint,operation text,expected_version integer,operator_id bigint,reason text,confirmation_code text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.stores%ROWTYPE; result jsonb; previous_context text:=current_setting('app.merchant_id',true);
BEGIN
 PERFORM set_config('app.merchant_id',target_merchant::text,true);
 IF operation NOT IN('disable','restore','delete') OR length(trim(reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.platform_users WHERE id=operator_id AND active=true) THEN RAISE EXCEPTION 'Invalid platform operator' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_merchant::text||':restore',0));
 SELECT * INTO s FROM public.stores WHERE merchant_id=target_merchant AND id=target_store FOR UPDATE;
 IF NOT FOUND THEN PERFORM set_config('app.merchant_id',coalesce(previous_context,''),true); RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
 IF s.deleted_at IS NOT NULL THEN PERFORM set_config('app.merchant_id',coalesce(previous_context,''),true); RETURN jsonb_build_object('error','STORE_DELETED'); END IF;
 IF s.management_version<>expected_version THEN PERFORM set_config('app.merchant_id',coalesce(previous_context,''),true); RETURN jsonb_build_object('error','VERSION_CONFLICT'); END IF;
 IF operation='delete' AND confirmation_code IS DISTINCT FROM s.code THEN PERFORM set_config('app.merchant_id',coalesce(previous_context,''),true); RETURN jsonb_build_object('error','CONFIRMATION_REQUIRED'); END IF;
 UPDATE public.stores SET status=CASE WHEN operation='restore' THEN 1 ELSE 0 END,deleted_at=CASE WHEN operation='delete' THEN now() ELSE NULL END WHERE merchant_id=target_merchant AND id=target_store;
 result=jsonb_build_object('id',s.id,'code',s.code,'name',s.name,'operation',operation,'recoverable',operation<>'delete','version',expected_version+1);
 INSERT INTO public.platform_audit(platform_user_id,merchant_id,action,detail) VALUES(operator_id,target_merchant,'store.'||operation,result||jsonb_build_object('previous_status',s.status,'reason',reason,'history_retained',true));
 PERFORM pg_notify('saas_access',jsonb_build_object('merchant_id',target_merchant)::text);
 PERFORM set_config('app.merchant_id',coalesce(previous_context,''),true); RETURN result;
END $$;
