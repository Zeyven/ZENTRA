-- Empty-store deletion remains constrained by forced tenant RLS and all existing foreign keys.
GRANT DELETE ON stores TO saas_runtime;
