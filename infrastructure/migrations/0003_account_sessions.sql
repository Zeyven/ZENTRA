CREATE TABLE account_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  session_hash text NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (provider, session_hash)
);
CREATE INDEX account_sessions_user_idx ON account_sessions(user_id, created_at DESC);
ALTER TABLE account_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY account_sessions_self_read ON account_sessions FOR SELECT TO application_role
  USING (user_id = ayra.current_actor_id());
GRANT SELECT ON account_sessions TO application_role;

-- The API calls this only after the provider has verified the session token.
CREATE FUNCTION ayra.register_verified_session(session_provider text, verified_hash text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id uuid := ayra.current_actor_id();
  session_id uuid;
BEGIN
  IF actor_id IS NULL OR session_provider IS NULL OR length(session_provider) NOT BETWEEN 1 AND 80
    OR verified_hash IS NULL OR verified_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid verified session' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.account_sessions(user_id, provider, session_hash)
    VALUES (actor_id, session_provider, verified_hash)
  ON CONFLICT (provider, session_hash) DO UPDATE
    SET last_seen_at = now()
    WHERE account_sessions.user_id = actor_id AND account_sessions.revoked_at IS NULL
  RETURNING id INTO session_id;
  RETURN session_id;
END;
$$;
REVOKE ALL ON FUNCTION ayra.register_verified_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.register_verified_session(text, text) TO application_role;

CREATE FUNCTION ayra.revoke_account_session(target_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.account_sessions SET revoked_at = now()
    WHERE id = target_id AND user_id = ayra.current_actor_id() AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION ayra.revoke_account_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.revoke_account_session(uuid) TO application_role;

CREATE FUNCTION ayra.revoke_other_sessions(current_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  changed integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.account_sessions
    WHERE id = current_id AND user_id = ayra.current_actor_id() AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Active current session required' USING ERRCODE = '28000';
  END IF;
  UPDATE public.account_sessions SET revoked_at = now()
    WHERE user_id = ayra.current_actor_id() AND id <> current_id AND revoked_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION ayra.revoke_other_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.revoke_other_sessions(uuid) TO application_role;
