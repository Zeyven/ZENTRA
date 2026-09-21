ALTER TABLE members ADD COLUMN asset_version integer NOT NULL DEFAULT 1 CHECK(asset_version>0);
