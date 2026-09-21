-- Additive configuration reservation only; no device connectivity or business events.
ALTER TABLE device_connections DROP CONSTRAINT device_connections_kind_check;
ALTER TABLE device_connections ADD CONSTRAINT device_connections_kind_check
 CHECK(kind IN('receipt_printer','wristband_reader','cash_drawer','customer_display','room_panel'));
ALTER TABLE device_connections DROP CONSTRAINT device_connections_transport_check;
ALTER TABLE device_connections ADD CONSTRAINT device_connections_transport_check
 CHECK(transport IN('unknown','system','keyboard','usb','serial','network'));
