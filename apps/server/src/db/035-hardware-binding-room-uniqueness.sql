-- A room panel belongs to exactly one gateway in a merchant.  Without this
-- constraint, two gateway processes could both accept the same panel and send
-- competing answers over the LAN.
CREATE UNIQUE INDEX hardware_bindings_one_gateway_per_room
 ON hardware_bindings(merchant_id,room_id);
