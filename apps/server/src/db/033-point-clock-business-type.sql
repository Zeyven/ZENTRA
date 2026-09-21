ALTER TABLE stores
 ADD COLUMN point_clock_business_type text
 CHECK(point_clock_business_type IN ('BATH','FOOT'));

