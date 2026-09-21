ALTER TABLE reservations ADD COLUMN booking_quote text;
ALTER TABLE booking_waitlist ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
CREATE INDEX public_booking_capacity ON reservations(merchant_id,store_id,reserve_time) WHERE status IN('pending','arrived','offered','awaiting_payment');
CREATE INDEX waitlist_pending ON booking_waitlist(merchant_id,store_id,preferred_start,id) WHERE status IN('waiting','offered');
