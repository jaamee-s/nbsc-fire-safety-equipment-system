-- ============================================================
-- Migration: a reason when staff switch to Unavailable (run after 020)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- Panel comment: "Reasons for availability?" When an inspector or
-- technician switches to Unavailable in the mobile app, the GSO only saw
-- that they are unavailable, not why. Now:
--
-- 1. profiles.availability_reason: the reason for being Unavailable right
--    now (e.g. "Sick", "On leave"). Cleared when they switch back to
--    Available.
-- 2. staff_availability_changes.reason: the reason saved with each switch,
--    so the GSO's bell and the person's calendar can show it.
-- 3. set_my_availability(p_available, p_reason): same checks as migration
--    017, plus the reason. The reason is optional here so phones still on
--    the older app keep working (their switches just have no reason); the
--    new app asks for one before switching to Unavailable.
-- 4. list_staff_availability() also returns the current reason, for the
--    inspector and technician cards on the web.
-- ============================================================

-- 1 & 2. Where the reasons are kept
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS availability_reason text;
ALTER TABLE public.staff_availability_changes ADD COLUMN IF NOT EXISTS reason text;

-- 3. Switching, with a reason
DROP FUNCTION IF EXISTS public.set_my_availability(boolean);

CREATE OR REPLACE FUNCTION public.set_my_availability(p_available boolean, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_before boolean;
  v_before_reason text;
  -- Available needs no reason; a blank reason counts as none.
  v_reason text := CASE WHEN p_available THEN NULL ELSE nullif(trim(coalesce(p_reason, '')), '') END;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Please sign in.'; END IF;
  IF p_available IS NULL THEN RAISE EXCEPTION 'Choose Available or Unavailable.'; END IF;
  IF length(coalesce(v_reason, '')) > 200 THEN
    RAISE EXCEPTION 'The reason is too long (200 characters at most).';
  END IF;

  SELECT role::text, is_available, availability_reason
    INTO v_role, v_before, v_before_reason
    FROM profiles WHERE id = v_uid;

  IF v_role = 'technician' THEN
    UPDATE technicians SET is_available = p_available WHERE profile_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Your technician record was not found. Please contact the GSO.';
    END IF;
  ELSIF v_role <> 'inspector' OR v_role IS NULL THEN
    RAISE EXCEPTION 'Only inspector and technician accounts can set their availability.';
  END IF;

  UPDATE profiles SET is_available = p_available, availability_reason = v_reason WHERE id = v_uid;

  -- A row for every real change: a new status, or a new reason while
  -- staying Unavailable. Saving the same status and reason again saves nothing.
  IF v_before IS DISTINCT FROM p_available
     OR (NOT p_available AND v_before_reason IS DISTINCT FROM v_reason) THEN
    INSERT INTO staff_availability_changes (profile_id, is_available, reason)
    VALUES (v_uid, p_available, v_reason);
  END IF;

  RETURN p_available;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_my_availability(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_availability(boolean, text) TO authenticated;

-- 4. The admin's list, now with the reason
DROP FUNCTION IF EXISTS public.list_staff_availability();

CREATE OR REPLACE FUNCTION public.list_staff_availability()
RETURNS TABLE (id uuid, role text, is_available boolean, availability_reason text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role::text IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Only admin accounts can see staff availability.';
  END IF;

  RETURN QUERY
    SELECT p.id, p.role::text, p.is_available, p.availability_reason
      FROM profiles p
     WHERE p.role::text IN ('inspector', 'technician');
END $$;

REVOKE EXECUTE ON FUNCTION public.list_staff_availability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_staff_availability() TO authenticated;
