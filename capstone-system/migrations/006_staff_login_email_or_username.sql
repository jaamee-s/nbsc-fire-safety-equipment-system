-- ============================================================
-- Migration: accept a username OR an email as the login (run after 005)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- In 005 the login had to be a plain username (e.g. kenntech). Typing an
-- email-style login (e.g. kenntech@nbsc-fses.local) was rejected. Now both
-- work, and whatever the admin types is exactly what the person types to
-- sign in to the mobile app:
--   kenntech                  -> signs in with "kenntech"
--   kenntech@nbsc-fses.local  -> signs in with "kenntech@nbsc-fses.local"
-- Everything else is unchanged from 005.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_staff_account(
  p_role text,
  p_full_name text,
  p_username text,
  p_password text,
  p_contact text DEFAULT NULL,
  p_technician_id uuid DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_login text := lower(trim(coalesce(p_username, '')));
  v_email text;
  v_name text := trim(coalesce(p_full_name, ''));
  v_role_type text;
  v_tech_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role::text IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Only admin accounts can create accounts.';
  END IF;
  IF p_role NOT IN ('inspector', 'technician') THEN
    RAISE EXCEPTION 'Account type must be inspector or technician.';
  END IF;
  IF p_technician_id IS NOT NULL AND p_role <> 'technician' THEN
    RAISE EXCEPTION 'Only a technician can be linked to a technician record.';
  END IF;
  IF p_technician_id IS NOT NULL THEN
    SELECT full_name INTO v_name FROM technicians WHERE id = p_technician_id;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Technician not found.'; END IF;
    IF EXISTS (SELECT 1 FROM technicians WHERE id = p_technician_id AND profile_id IS NOT NULL) THEN
      RAISE EXCEPTION 'This technician already has an app account.';
    END IF;
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;

  IF position('@' IN v_login) > 0 THEN
    -- An email-style login is used exactly as typed.
    IF v_login !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
      RAISE EXCEPTION 'That email-style username is not complete. Example: kenntech@nbsc-fses.local';
    END IF;
    v_email := v_login;
  ELSE
    IF v_login !~ '^[a-z0-9._-]{3,30}$' THEN
      RAISE EXCEPTION 'Use 3 to 30 letters or numbers, with no spaces. Example: kenntech';
    END IF;
    v_email := v_login || '@nbsc-firesafety.local';
  END IF;

  IF length(coalesce(p_password, '')) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters.';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'The username "%" is already taken.', v_login;
  END IF;

  -- The login itself (confirmed right away; nobody receives an email).
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf')),
    now(), '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('full_name', v_name, 'username', v_login),
    now(), now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_uid, v_uid::text, 'email',
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
    now(), now(), now()
  );

  -- The profile that gives the account its role. The role column's exact
  -- type is looked up so this works whether it is text or an enum.
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_role_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'role';

  EXECUTE format(
    'INSERT INTO public.profiles (id, full_name, role) VALUES ($1, $2, $3::%s)
     ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role',
    v_role_type
  ) USING v_uid, v_name, p_role;

  IF p_role = 'technician' THEN
    IF p_technician_id IS NOT NULL THEN
      UPDATE technicians SET profile_id = v_uid WHERE id = p_technician_id;
      v_tech_id := p_technician_id;
    ELSE
      INSERT INTO technicians (full_name, contact_info, is_available, profile_id)
      VALUES (v_name, nullif(trim(coalesce(p_contact, '')), ''), true, v_uid)
      RETURNING id INTO v_tech_id;
    END IF;
  END IF;

  RETURN json_build_object('user_id', v_uid, 'username', v_login, 'technician_id', v_tech_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.create_staff_account(text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_staff_account(text, text, text, text, text, uuid) TO authenticated;
