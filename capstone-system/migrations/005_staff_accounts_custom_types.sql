-- ============================================================
-- Migration: staff accounts from the web app + custom equipment types
-- (run after 004)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- 1. create_staff_account(): the admin creates an inspector or technician
--    login (username + password) from the web app. The account can sign in
--    to the mobile app right away. Only admin accounts may call it.
--    Usernames are stored as <username>@nbsc-firesafety.local, because
--    Supabase logins are email-based; the mobile app adds that ending when
--    someone signs in with just a username.
-- 2. list_staff_accounts(): lets the admin see staff accounts and their
--    usernames (profiles are otherwise private to each user).
-- 3. Equipment types are no longer limited to the 5 built-in ones ("Others"
--    in the Add Equipment form), and every type automatically gets a row in
--    the Stock page.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- 1. Create an inspector / technician account -------------------------------
-- p_technician_id: give an EXISTING technician (added before accounts
-- existed) a login instead of creating a new technician row.
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
  v_username text := lower(trim(coalesce(p_username, '')));
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
  IF v_username !~ '^[a-z0-9._-]{3,30}$' THEN
    RAISE EXCEPTION 'Username must be 3 to 30 characters: letters, numbers, dot, dash or underscore (no spaces).';
  END IF;
  IF length(coalesce(p_password, '')) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters.';
  END IF;

  v_email := v_username || '@nbsc-firesafety.local';
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'The username "%" is already taken.', v_username;
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
    jsonb_build_object('full_name', v_name, 'username', v_username),
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

  RETURN json_build_object('user_id', v_uid, 'username', v_username, 'technician_id', v_tech_id);
END $$;

REVOKE EXECUTE ON FUNCTION public.create_staff_account(text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_staff_account(text, text, text, text, text, uuid) TO authenticated;


-- 2. List staff accounts (admin only) ---------------------------------------
CREATE OR REPLACE FUNCTION public.list_staff_accounts()
RETURNS TABLE (id uuid, full_name text, role text, username text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role::text IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Only admin accounts can list accounts.';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name::text, p.role::text,
           CASE WHEN u.email LIKE '%@nbsc-firesafety.local'
                THEN split_part(u.email, '@', 1)
                ELSE u.email END::text,
           u.created_at
    FROM profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.role::text IN ('inspector', 'technician')
    ORDER BY p.full_name;
END $$;

REVOKE EXECUTE ON FUNCTION public.list_staff_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_staff_accounts() TO authenticated;


-- 3. Custom equipment types --------------------------------------------------
-- Remove the rule that only allowed the 5 built-in types (whether it is a
-- CHECK constraint or an enum column type).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.equipment'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%equipment_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.equipment DROP CONSTRAINT %I', r.conname);
  END LOOP;

  IF (
    SELECT t.typtype FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = 'public.equipment'::regclass AND a.attname = 'equipment_type'
  ) = 'e' THEN
    ALTER TABLE public.equipment ALTER COLUMN equipment_type TYPE text USING equipment_type::text;
  END IF;
END $$;

-- A type still can't be blank.
ALTER TABLE public.equipment DROP CONSTRAINT IF EXISTS equipment_type_not_blank;
ALTER TABLE public.equipment
  ADD CONSTRAINT equipment_type_not_blank CHECK (length(trim(equipment_type)) > 0);

-- Every equipment type gets a Stock row automatically.
CREATE OR REPLACE FUNCTION public.ensure_stock_row_for_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO equipment_stock (equipment_type, quantity_available)
  VALUES (NEW.equipment_type, 0)
  ON CONFLICT (equipment_type) DO NOTHING;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.ensure_stock_row_for_type() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ensure_stock_row ON equipment;
CREATE TRIGGER trg_ensure_stock_row
  AFTER INSERT OR UPDATE OF equipment_type ON equipment
  FOR EACH ROW EXECUTE FUNCTION public.ensure_stock_row_for_type();

-- Types that already exist get their Stock row now.
INSERT INTO equipment_stock (equipment_type, quantity_available)
SELECT DISTINCT equipment_type, 0 FROM equipment
ON CONFLICT (equipment_type) DO NOTHING;
