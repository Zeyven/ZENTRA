ALTER TABLE reservations DROP CONSTRAINT reservations_known_status;
ALTER TABLE reservations ADD CONSTRAINT reservations_known_status CHECK(status IN('pending','arrived','completed','cancelled','deleted','offered','awaiting_payment'));
