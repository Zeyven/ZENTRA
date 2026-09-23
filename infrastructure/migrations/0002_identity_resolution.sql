-- Only the API's verified IdentityProvider adapter may call this function.
CREATE FUNCTION ayra.resolve_external_identity(identity_provider text, external_subject text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  resolved_user_id uuid;
BEGIN
  IF identity_provider IS NULL OR length(identity_provider) NOT BETWEEN 1 AND 80
    OR external_subject IS NULL OR length(external_subject) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'Invalid verified identity' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(identity_provider || ':' || external_subject, 0));
  SELECT user_id INTO resolved_user_id
    FROM public.external_identities
    WHERE provider = identity_provider AND provider_subject = external_subject;
  IF resolved_user_id IS NOT NULL THEN
    RETURN resolved_user_id;
  END IF;

  INSERT INTO public.users(display_name) VALUES ('AYRA User') RETURNING id INTO resolved_user_id;
  INSERT INTO public.external_identities(user_id, provider, provider_subject)
    VALUES (resolved_user_id, identity_provider, external_subject);
  RETURN resolved_user_id;
END;
$$;
REVOKE ALL ON FUNCTION ayra.resolve_external_identity(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ayra.resolve_external_identity(text, text) TO application_role;
