-- Keep platform operations in the central audit stream in the same business
-- transaction. Restoring merchant business history cannot erase this stream.
CREATE OR REPLACE FUNCTION mirror_platform_operation_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.platform_user_id IS NOT NULL AND NOT (
  session_user='postgres' AND coalesce(current_setting('app.recovery_merchant_id',true),'')=NEW.merchant_id::text
 ) THEN
  INSERT INTO public.platform_audit(platform_user_id,merchant_id,action,detail)
  VALUES(NEW.platform_user_id,NEW.merchant_id,NEW.action,
   jsonb_build_object('merchant_audit_id',NEW.id,'store_id',NEW.store_id,
    'operation_user_id',NEW.user_id,'support_grant_id',NEW.support_grant_id,
    'object_type',NEW.object_type,'object_id',NEW.object_id,'operation',NEW.detail));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mirror_platform_operation_audit() FROM PUBLIC;
CREATE TRIGGER platform_operation_audited AFTER INSERT ON audit_events
 FOR EACH ROW EXECUTE FUNCTION mirror_platform_operation_audit();
