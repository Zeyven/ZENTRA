# SQL-first migrations

M0 establishes local roles only. Business schema and Drizzle mappings begin at M1/M2. Normal traffic uses `application_role`, never `migration_role`. Tenant tables must enable and force RLS with explicit grants. Every schema change requires expand/migrate/switch/contract and a reviewed rollback. No production migrations exist yet.
