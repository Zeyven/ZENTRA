-- AYRA BASELINE v1.0 M1. Run as migration_role, never as application_role.
CREATE SCHEMA IF NOT EXISTS ayra;
REVOKE ALL ON SCHEMA ayra FROM PUBLIC;
GRANT USAGE ON SCHEMA ayra TO application_role;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE external_identities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  provider_subject text NOT NULL CHECK (length(provider_subject) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);
CREATE INDEX external_identities_user_idx ON external_identities(user_id);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE workspace_memberships (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REMOVED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX workspace_memberships_user_idx ON workspace_memberships(user_id, status);

CREATE FUNCTION ayra.current_actor_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('ayra.actor_user_id', true), '')::uuid $$;

-- The table owner resolves membership without recursive membership RLS policies.
CREATE FUNCTION ayra.has_active_membership(actor_id uuid, tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE user_id = actor_id AND workspace_id = tenant_id AND status = 'ACTIVE'
  )
$$;

CREATE FUNCTION ayra.has_owner_role(actor_id uuid, tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE user_id = actor_id AND workspace_id = tenant_id
      AND status = 'ACTIVE' AND role = 'OWNER'
  )
$$;

REVOKE ALL ON FUNCTION ayra.current_actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION ayra.has_active_membership(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ayra.has_owner_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.current_actor_id() TO application_role;
GRANT EXECUTE ON FUNCTION ayra.has_active_membership(uuid, uuid) TO application_role;
GRANT EXECUTE ON FUNCTION ayra.has_owner_role(uuid, uuid) TO application_role;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_self_read ON users FOR SELECT TO application_role
  USING (id = ayra.current_actor_id() AND deleted_at IS NULL);

ALTER TABLE external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_identities FORCE ROW LEVEL SECURITY;
-- Provider IDs stay in the identity adapter's privileged mapping path.

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspaces_member_read ON workspaces FOR SELECT TO application_role
  USING (ayra.has_active_membership(ayra.current_actor_id(), id) AND archived_at IS NULL);
CREATE POLICY workspaces_owner_update ON workspaces FOR UPDATE TO application_role
  USING (ayra.has_owner_role(ayra.current_actor_id(), id))
  WITH CHECK (ayra.has_owner_role(ayra.current_actor_id(), id));

ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_member_read ON workspace_memberships FOR SELECT TO application_role
  USING (ayra.has_active_membership(ayra.current_actor_id(), workspace_id));

GRANT SELECT ON users, workspaces, workspace_memberships TO application_role;
GRANT UPDATE (name, updated_at) ON workspaces TO application_role;

-- Creation is atomic: no workspace can exist without its OWNER membership.
CREATE FUNCTION ayra.create_workspace(workspace_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id uuid := ayra.current_actor_id();
  new_id uuid;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = actor_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Authenticated AYRA user required' USING ERRCODE = '28000';
  END IF;
  INSERT INTO public.workspaces(name) VALUES (workspace_name) RETURNING id INTO new_id;
  INSERT INTO public.workspace_memberships(workspace_id, user_id, role, status)
    VALUES (new_id, actor_id, 'OWNER', 'ACTIVE');
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION ayra.create_workspace(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.create_workspace(text) TO application_role;
