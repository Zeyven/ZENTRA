-- Ordinary platform and merchant APIs still cannot revive permanently deleted stores.
-- Only the root-operated, merchant-scoped backup recovery transaction may replace them.
CREATE OR REPLACE FUNCTION protect_deleted_store() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.deleted_at IS NOT NULL AND NOT (
   current_user='postgres' AND
   coalesce(current_setting('app.recovery_merchant_id',true),'')=OLD.merchant_id::text
 ) THEN RAISE EXCEPTION 'Deleted store cannot be changed or restored' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN NEW.management_version=OLD.management_version+1; RETURN NEW; END IF;
 RETURN OLD;
END $$;
