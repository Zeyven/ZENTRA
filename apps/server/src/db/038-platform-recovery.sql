CREATE TABLE platform_backup_archives(
 id text PRIMARY KEY,created_at timestamptz NOT NULL,sha256 text NOT NULL,bytes bigint NOT NULL,
 available boolean NOT NULL DEFAULT true,checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_recovery_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),
 platform_user_id bigint NOT NULL REFERENCES platform_users(id),session_id uuid NOT NULL REFERENCES platform_sessions(id),
 grant_id uuid NOT NULL REFERENCES support_grants(id),archive_id text NOT NULL REFERENCES platform_backup_archives(id),
 kind text NOT NULL CHECK(kind IN ('preview','restore')),preview_id uuid REFERENCES platform_recovery_jobs(id),
 reason text NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
 result jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
CREATE UNIQUE INDEX one_merchant_recovery_job ON platform_recovery_jobs(merchant_id) WHERE status IN ('queued','running');
ALTER TABLE platform_backup_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_backup_archives FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_backup_metadata ON platform_backup_archives TO saas_platform USING(true);
ALTER TABLE platform_recovery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_recovery_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_recovery_metadata ON platform_recovery_jobs TO saas_platform USING(true) WITH CHECK(true);
GRANT SELECT ON platform_backup_archives TO saas_platform;
GRANT SELECT,INSERT ON platform_recovery_jobs TO saas_platform;
