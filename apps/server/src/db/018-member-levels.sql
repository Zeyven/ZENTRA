ALTER TABLE members ADD COLUMN base_level text NOT NULL DEFAULT '普通会员';
UPDATE members SET base_level=level;
CREATE INDEX member_closed_consumption ON orders(merchant_id,member_id) INCLUDE(payable) WHERE status='closed';
