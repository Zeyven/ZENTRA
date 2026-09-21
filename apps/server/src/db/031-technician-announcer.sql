-- Additive draft configuration; no network connection or automatic broadcast.
ALTER TABLE device_connections DROP CONSTRAINT device_connections_kind_check;
ALTER TABLE device_connections ADD CONSTRAINT device_connections_kind_check
 CHECK(kind IN('receipt_printer','wristband_reader','cash_drawer','customer_display','room_panel','technician_announcer'));
ALTER TABLE device_connections ADD COLUMN announcer_config jsonb;
ALTER TABLE device_connections ADD CONSTRAINT device_announcer_config_check
 CHECK(announcer_config IS NULL OR (kind='technician_announcer' AND jsonb_typeof(announcer_config)='object'));
