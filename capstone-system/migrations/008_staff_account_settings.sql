-- ============================================================
-- Migration: change a staff account's username / password (run after 007)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- update_staff_account(): the admin changes an inspector's or technician's
-- mobile app username and/or sets a new password (e.g. they forgot it).
-- Only admin accounts may call it. The current password is never shown —
-- passwords are stored encrypted — so a forgotten one is replaced.
-- Username rules are the same as when the account was created (006).
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_staff_account(
  p_user_id uuid,
  p_username text,
  p_password text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_login text := lower(trim(coalesce(p_username, '')));
  v_email text;
  v_password_changed boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role::text IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Only admin accounts can change accounts.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_user_id AND role::text IN ('inspector', 'technician')
  ) THEN
    RAISE EXCEPTION 'Account not found.';
  END IF;

  IF position('@' IN v_login) > 0 THEN
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

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email AND id <> p_user_id) THEN
    RAISE EXCEPTION 'The username "%" is already taken.', v_login;
  END IF;

  UPDATE auth.users
     SET email = v_email,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', v_login),
         updated_at = now()
   WHERE id = p_user_id;

  UPDATE auth.identities
     SET identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_email),
         updated_at = now()
   WHERE user_id = p_user_id AND provider = 'email';

  IF coalesce(p_password, '') <> '' THEN
    IF length(p_password) < 6 THEN
      RAISE EXCEPTION 'Password must be at least 6 characters.';
    END IF;
    UPDATE auth.users
       SET encrypted_password = crypt(p_password, gen_salt('bf')),
           updated_at = now()
     WHERE id = p_user_id;
    v_password_changed := true;
  END IF;

  RETURN json_build_object('username', v_login, 'password_changed', v_password_changed);
END $$;

REVOKE EXECUTE ON FUNCTION public.update_staff_account(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_staff_account(uuid, text, text) TO authenticated;
