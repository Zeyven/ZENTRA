ALTER TABLE asset_operations ADD COLUMN funded_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK(funded_amount>=0);
ALTER TABLE members ADD CHECK(balance<=999999999999.99 AND bonus_balance<=999999999999.99 AND times_balance<=1000000000 AND points<=1000000000);
