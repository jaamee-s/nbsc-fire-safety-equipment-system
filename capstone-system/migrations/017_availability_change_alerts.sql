-- ============================================================
-- Migration: notify the GSO when staff change their availability
-- (run after 016)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- When an inspector or technician switches Available / Unavailable on the
-- phone, nothing recorded when it happened, so the admin's bell had no
-- event to show. Now:
--
-- 1. staff_availability_changes: one row per real change (who, the new
--    value, when). Only set_my_availability() writes to it; admins and
--    managers can read it; staff cannot read, add or edit rows.
--
-- 2. set_my_availability(): same checks and result as migration 009, and it
--    now saves a row when the value actually changes (switching to the
--    value it already has saves nothing).
--
-- 3. Live updates are turned on for the new table, so the admin's bell
--    rings the moment someone switches.
-- ============================================================

-- 1. The change log
CREATE TABLE IF NOT EXISTS public.staff_availability_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_available boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_availability_changes_changed_at_idx
  ON public.staff_availability_changes (changed_at DESC);

ALTER TABLE public.staff_availability_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read availability changes" ON public.staff_availability_changes;
CREATE POLICY "admins read availability changes"
  ON public.staff_availability_changes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager')));

-- 2. Save a row when the value really changes
CREATE OR REPLACE FUNCTION public.set_my_availability(p_available boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_before boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Please sign in.'; END IF;
  IF p_available IS NULL THEN RAISE EXCEPTION 'Choose Available or Unavailable.'; END IF;

  SELECT role::text, is_available INTO v_role, v_before FROM profiles WHERE id = v_uid;

  IF v_role = 'technician' THEN
    UPDATE technicians SET is_available = p_available WHERE profile_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Your technician record was not found. Please contact the GSO.';
    END IF;
  ELSIF v_role <> 'inspector' OR v_role IS NULL THEN
    RAISE EXCEPTION 'Only inspector and technician accounts can set their availability.';
  END IF;

  UPDATE profiles SET is_available = p_available WHERE id = v_uid;

  IF v_before IS DISTINCT FROM p_available THEN
    INSERT INTO staff_availability_changes (profile_id, is_available) VALUES (v_uid, p_available);
  END IF;

  RETURN p_available;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_my_availability(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_availability(boolean) TO authenticated;

-- 3. Live updates for the new table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename = 'staff_availability_changes'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_availability_changes;
  END IF;
END $$;
