-- ============================================================
-- Migration: edit a staff member's name and contact too (run after 018)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- The dashboard now has one "Edit account" window for inspectors and
-- technicians: name, contact (technicians only), username and password.
-- update_staff_account() from migration 008 only changed the username and
-- password, and nothing let the admin fix an inspector's name.
--
-- Same checks as 008 (admins and managers only, same username rules), plus:
--   p_full_name  new name, saved on the account and, for a technician, on
--                their technician record too, so both always match.
--                NULL keeps the current name.
--   p_contact    technician's contact info. NULL keeps it, '' clears it.
--
-- Past inspections keep the inspector name written on them when they were
-- submitted; they are still linked to the account itself.
-- ============================================================

DROP FUNCTION IF EXISTS public.update_staff_account(uuid, text, text);

CREATE OR REPLACE FUNCTION public.update_staff_account(
  p_user_id uuid,
  p_username text,
  p_password text DEFAULT NULL,
  p_full_name text DEFAULT NULL,
  p_contact text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_login text := lower(trim(coalesce(p_username, '')));
  v_name text := trim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
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

  IF p_full_name IS NOT NULL THEN
    IF v_name = '' THEN
      RAISE EXCEPTION 'The name cannot be empty.';
    END IF;
    IF length(v_name) > 100 THEN
      RAISE EXCEPTION 'The name is too long (100 characters at most).';
    END IF;
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
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
           || jsonb_build_object('username', v_login)
           || CASE WHEN p_full_name IS NOT NULL THEN jsonb_build_object('full_name', v_name) ELSE '{}'::jsonb END,
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

  IF p_full_name IS NOT NULL THEN
    UPDATE profiles SET full_name = v_name WHERE id = p_user_id;
    UPDATE technicians SET full_name = v_name WHERE profile_id = p_user_id;
  END IF;

  IF p_contact IS NOT NULL THEN
    UPDATE technicians SET contact_info = nullif(trim(p_contact), '') WHERE profile_id = p_user_id;
  END IF;

  RETURN json_build_object(
    'username', v_login,
    'password_changed', v_password_changed,
    'full_name', CASE WHEN p_full_name IS NOT NULL THEN v_name END
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.update_staff_account(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_staff_account(uuid, text, text, text, text) TO authenticated;
