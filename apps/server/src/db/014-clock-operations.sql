ALTER TABLE room_warnings ALTER COLUMN created_at TYPE bigint,ALTER COLUMN expires_at TYPE bigint,ALTER COLUMN acknowledged_at TYPE bigint,ALTER COLUMN cancelled_at TYPE bigint;
ALTER TABLE room_warnings ADD CHECK(expires_at>created_at),ADD CHECK(NOT(acknowledged_at IS NOT NULL AND cancelled_at IS NOT NULL));
CREATE INDEX room_warnings_pending ON room_warnings(merchant_id,store_id,expires_at) WHERE acknowledged_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX attendance_reporting ON attendance(merchant_id,store_id,date,technician_id);
