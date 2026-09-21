ALTER TABLE reservations ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE reservations ADD CONSTRAINT reservations_people_positive CHECK(people BETWEEN 1 AND 1000);
ALTER TABLE reservations ADD CONSTRAINT reservations_duration_positive CHECK(duration BETWEEN 1 AND 1440);
ALTER TABLE reservations ADD CONSTRAINT reservations_known_status CHECK(status IN('pending','arrived','completed','cancelled','deleted'));
CREATE INDEX reservations_availability ON reservations(merchant_id,store_id,reserve_time) WHERE status IN('pending','arrived');
ALTER TABLE queue ADD COLUMN business_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Shanghai')::date;
ALTER TABLE queue ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE queue ADD COLUMN access_token_hash text;
ALTER TABLE queue ADD CONSTRAINT queue_people_positive CHECK(people BETWEEN 1 AND 1000);
ALTER TABLE queue ADD CONSTRAINT queue_known_status CHECK(status IN('waiting','called','done','cancelled'));
CREATE UNIQUE INDEX queue_daily_number ON queue(merchant_id,store_id,business_date,queue_no);
CREATE INDEX queue_current_day ON queue(merchant_id,store_id,business_date,status);
CREATE TABLE public_rate_limits(
 merchant_id uuid NOT NULL DEFAULT require_merchant_id(),store_id bigint NOT NULL,bucket text NOT NULL,
 window_start timestamptz NOT NULL,hits integer NOT NULL DEFAULT 1,
 PRIMARY KEY(merchant_id,store_id,bucket),FOREIGN KEY(merchant_id,store_id) REFERENCES stores(merchant_id,id)
);
ALTER TABLE public_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON public_rate_limits TO saas_runtime USING(merchant_id=require_merchant_id()) WITH CHECK(merchant_id=require_merchant_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON public_rate_limits TO saas_runtime;
