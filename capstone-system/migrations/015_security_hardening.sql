-- ============================================================
-- Migration: security hardening (run after 014)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- Also turn OFF public sign-up (not possible from SQL):
--   Dashboard -> Authentication -> Sign In / Providers -> Email ->
--   "Allow new users to sign up" = off.
--   Staff accounts are made by create_staff_account(), which does not use
--   sign-up, so the GSO can still add inspectors and technicians.
--
-- 1. No reading without logging in
--    equipment and buildings had "Anonymous can read ..." rules, so anyone
--    with the public key could list every unit, location and QR code
--    without an account. Both rules are removed.
--
-- 2. Reading needs a staff account, not just any login
--    equipment, buildings, building_locations, inspections,
--    maintenance_actions, equipment_stock and technicians could be read by
--    ANY signed-in user. Now the account must have a staff profile
--    (admin, manager, inspector or technician). What each role sees in the
--    apps does not change.
--
-- 3. Inspections and repair jobs only through the app's checks
--    Inspectors could insert rows into inspections and maintenance_actions
--    directly through the API, skipping submit_inspector_inspection() and
--    its checks. Neither app inserts these rows directly (the phone always
--    uses the RPC), so direct inserts are limited to admin/manager.
--    This step runs only if submit_inspector_inspection() is SECURITY
--    DEFINER (it then does not need these rules); otherwise it is skipped
--    with a notice, so inspections can never break.
--
-- 4. A deleted technician can no longer sign in
--    Deleting a technician removed the record but left the login. Now the
--    login is blocked (banned), signed out everywhere and its phones stop
--    receiving push alerts. Logins of technicians deleted before this
--    migration are blocked too.
-- ============================================================

-- 1. No reading without logging in
DROP POLICY IF EXISTS "Anonymous can read equipment for QR lookup" ON public.equipment;
DROP POLICY IF EXISTS "Anonymous can read buildings for display" ON public.buildings;

-- 2. Reading needs a staff account
DROP POLICY IF EXISTS "Authenticated users can read equipment" ON public.equipment;
DROP POLICY IF EXISTS "Staff can read equipment" ON public.equipment;
CREATE POLICY "Staff can read equipment"
  ON public.equipment FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager', 'inspector', 'technician')));

DROP POLICY IF EXISTS "Authenticated users can read buildings" ON public.buildings;
DROP POLICY IF EXISTS "Staff can read buildings" ON public.buildings;
CREATE POLICY "Staff can read buildings"
  ON public.buildings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager', 'inspector', 'technician')));

DROP POLICY IF EXISTS "Authenticated users can read building_locations" ON public.building_locations;
DROP POLICY IF EXISTS "Staff can read building_locations" ON public.building_locations;
CREATE POLICY "Staff can read building_locations"
  ON public.building_locations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager', 'inspector', 'technician')));

DROP POLICY IF EXISTS "Authenticated users can read inspections" ON public.inspections;
DROP POLICY IF EXISTS "Staff can read inspections" ON public.inspections;
CREATE POLICY "Staff can read inspections"
  ON public.inspections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager', 'inspector', 'technician')));

DROP POLICY IF EXISTS "Authenticated users can read maintenance_actions" ON public.maintenance_actions;
DROP POLICY IF EXISTS "Staff can read maintenance_actions" ON public.maintenance_actions;
CREATE POLICY "Staff can read maintenance_actions"
  ON public.maintenance_actions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager', 'inspector', 'technician')));

DROP POLICY IF EXISTS "Authenticated users can read stock" ON public.equipment_stock;
DROP POLICY IF EXISTS "Staff can read stock" ON public.equipment_stock;
CREATE POLICY "Staff can read stock"
  ON public.equipment_stock FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager', 'inspector', 'technician')));

DROP POLICY IF EXISTS "Authenticated users can read technicians" ON public.technicians;
DROP POLICY IF EXISTS "Staff can read technicians" ON public.technicians;
CREATE POLICY "Staff can read technicians"
  ON public.technicians FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager', 'inspector', 'technician')));

-- 3. Inspections and repair jobs only through the app's checks
DO $$
DECLARE
  v_definer boolean;
BEGIN
  SELECT bool_and(p.prosecdef) INTO v_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'submit_inspector_inspection';

  IF v_definer IS TRUE THEN
    DROP POLICY IF EXISTS "Inspectors and admins can insert inspections" ON public.inspections;
    DROP POLICY IF EXISTS "Admins and managers can insert inspections" ON public.inspections;
    CREATE POLICY "Admins and managers can insert inspections"
      ON public.inspections FOR INSERT TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                          AND p.role::text IN ('admin', 'manager')));

    DROP POLICY IF EXISTS "Inspectors and admins can insert maintenance_actions" ON public.maintenance_actions;
    DROP POLICY IF EXISTS "Admins and managers can insert maintenance_actions" ON public.maintenance_actions;
    CREATE POLICY "Admins and managers can insert maintenance_actions"
      ON public.maintenance_actions FOR INSERT TO authenticated
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                          AND p.role::text IN ('admin', 'manager')));
    RAISE NOTICE 'Step 3 applied: direct inserts limited to admin/manager.';
  ELSE
    RAISE NOTICE 'Step 3 skipped: submit_inspector_inspection is not SECURITY DEFINER (or missing), so the inspector insert rules are kept.';
  END IF;
END $$;

-- 4. A deleted technician can no longer sign in
CREATE OR REPLACE FUNCTION public.block_deleted_technician_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF OLD.profile_id IS NOT NULL THEN
    UPDATE auth.users SET banned_until = 'infinity' WHERE id = OLD.profile_id;
    DELETE FROM auth.sessions WHERE user_id = OLD.profile_id;
    DELETE FROM public.push_tokens WHERE user_id = OLD.profile_id;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.block_deleted_technician_login() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS block_deleted_technician_login ON public.technicians;
CREATE TRIGGER block_deleted_technician_login
  AFTER DELETE ON public.technicians
  FOR EACH ROW EXECUTE FUNCTION public.block_deleted_technician_login();

-- Technicians already deleted before this migration: a technician login
-- with no technician record left.
DO $$
DECLARE
  v_count int;
BEGIN
  WITH orphans AS (
    SELECT p.id FROM public.profiles p
     WHERE p.role::text = 'technician'
       AND NOT EXISTS (SELECT 1 FROM public.technicians t WHERE t.profile_id = p.id)
  ), banned AS (
    UPDATE auth.users u SET banned_until = 'infinity'
      FROM orphans o
     WHERE u.id = o.id AND (u.banned_until IS NULL OR u.banned_until < 'infinity')
    RETURNING u.id
  )
  SELECT count(*) INTO v_count FROM banned;

  DELETE FROM auth.sessions s
   USING public.profiles p
   WHERE s.user_id = p.id AND p.role::text = 'technician'
     AND NOT EXISTS (SELECT 1 FROM public.technicians t WHERE t.profile_id = p.id);
  DELETE FROM public.push_tokens pt
   USING public.profiles p
   WHERE pt.user_id = p.id AND p.role::text = 'technician'
     AND NOT EXISTS (SELECT 1 FROM public.technicians t WHERE t.profile_id = p.id);

  RAISE NOTICE 'Step 4: blocked % login(s) of technicians deleted earlier.', v_count;
END $$;

-- Check afterwards (optional):
--   select tablename, policyname, cmd from pg_policies
--    where schemaname = 'public' order by tablename, cmd;
