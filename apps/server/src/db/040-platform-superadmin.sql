-- Platform operation identities satisfy existing business foreign keys without
-- impersonating the owner. They cannot be used for merchant login.
ALTER TABLE merchant_users ADD COLUMN platform_user_id bigint REFERENCES platform_users(id);
CREATE UNIQUE INDEX merchant_platform_actor ON merchant_users(merchant_id,platform_user_id) WHERE platform_user_id IS NOT NULL;
ALTER TABLE merchant_users ADD CONSTRAINT platform_actor_kind CHECK(platform_user_id IS NULL OR role='employee');

ALTER TABLE platform_recovery_jobs ALTER COLUMN grant_id DROP NOT NULL;
ALTER TABLE platform_recovery_jobs ADD COLUMN authorization_mode text NOT NULL DEFAULT 'support'
 CHECK(authorization_mode IN ('support','platform'));
ALTER TABLE platform_recovery_jobs ADD COLUMN platform_token_version integer;
ALTER TABLE platform_recovery_jobs ADD CONSTRAINT recovery_authority CHECK(
 (authorization_mode='support' AND grant_id IS NOT NULL) OR
 (authorization_mode='platform' AND grant_id IS NULL AND platform_token_version IS NOT NULL)
);
