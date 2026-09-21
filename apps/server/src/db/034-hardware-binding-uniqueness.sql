CREATE UNIQUE INDEX hardware_bindings_one_room_per_gateway
 ON hardware_bindings(merchant_id,gateway_id,room_id);

CREATE UNIQUE INDEX hardware_bindings_one_ip_per_gateway
 ON hardware_bindings(merchant_id,gateway_id,device_ip);
