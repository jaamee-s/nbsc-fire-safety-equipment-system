-- ============================================================
-- Migration: staff availability + numbers for the new dashboards (run after 008)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- 1. profiles.is_available
--      Inspectors now have an Available / Unavailable status too.
--      (Technicians already have technicians.is_available.)
--
-- 2. set_my_availability(p_available)
--      Inspectors and technicians set their OWN status from the mobile app.
--      The admin no longer sets it from the web.
--
-- 3. list_staff_availability()
--      Admin only: every inspector's and technician's status, for the web
--      Inspectors page.
--
-- 4. get_my_stats()
--      The signed-in inspector's or technician's numbers, counted exactly the
--      same way as the web Inspectors / Technicians cards:
--        inspector:  today, week (last 7 days), total, defects
--        technician: assigned (open jobs not yet marked repaired),
--                    working, awaiting_gso, completed
--      plus day-by-day counts for the last 28 days for the Summary graphs.
--      "Today" and days use Philippine time (Asia/Manila).
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;

-- A technician's status lives on the technicians row; copy it over once so
-- both places agree from the start.
UPDATE public.profiles p
   SET is_available = t.is_available
  FROM public.technicians t
 WHERE t.profile_id = p.id
   AND t.is_available IS NOT NULL
   AND p.is_available IS DISTINCT FROM t.is_available;


-- Live updates: when a technician changes their status on the phone, the web
-- Technicians page and the Job Order form update by themselves.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'technicians'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.technicians;
  END IF;
END $$;


-- ---------- 2. set_my_availability ----------
CREATE OR REPLACE FUNCTION public.set_my_availability(p_available boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Please sign in.'; END IF;
  IF p_available IS NULL THEN RAISE EXCEPTION 'Choose Available or Unavailable.'; END IF;

  SELECT role::text INTO v_role FROM profiles WHERE id = v_uid;

  IF v_role = 'technician' THEN
    UPDATE technicians SET is_available = p_available WHERE profile_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Your technician record was not found. Please contact the GSO.';
    END IF;
  ELSIF v_role <> 'inspector' OR v_role IS NULL THEN
    RAISE EXCEPTION 'Only inspector and technician accounts can set their availability.';
  END IF;

  UPDATE profiles SET is_available = p_available WHERE id = v_uid;
  RETURN p_available;
END $$;

REVOKE EXECUTE ON FUNCTION public.set_my_availability(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_availability(boolean) TO authenticated;


-- ---------- 3. list_staff_availability ----------
CREATE OR REPLACE FUNCTION public.list_staff_availability()
RETURNS TABLE (id uuid, role text, is_available boolean)
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
    SELECT p.id, p.role::text, p.is_available
      FROM profiles p
     WHERE p.role::text IN ('inspector', 'technician');
END $$;

REVOKE EXECUTE ON FUNCTION public.list_staff_availability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_staff_availability() TO authenticated;


-- ---------- 4. get_my_stats ----------
CREATE OR REPLACE FUNCTION public.get_my_stats()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_available boolean;
  v_tech uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Manila')::date;
  v_day_start timestamptz :=
    (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Please sign in.'; END IF;
  SELECT role::text, is_available INTO v_role, v_available FROM profiles WHERE id = v_uid;

  IF v_role = 'inspector' THEN
    RETURN json_build_object(
      'role', 'inspector',
      'is_available', coalesce(v_available, true),
      'today', (SELECT count(*) FROM inspections
                 WHERE inspector_id = v_uid AND inspection_date >= v_day_start),
      'week', (SELECT count(*) FROM inspections
                WHERE inspector_id = v_uid AND inspection_date >= now() - interval '7 days'),
      'total', (SELECT count(*) FROM inspections WHERE inspector_id = v_uid),
      'defects', (SELECT count(*) FROM inspections
                   WHERE inspector_id = v_uid AND condition_status = 'defective'),

      -- One row per day, oldest first, for the last 28 days (today included).
      'days', (
        SELECT coalesce(json_agg(d ORDER BY d.day), '[]'::json) FROM (
          SELECT g.day::date AS day,
                 count(i.id) FILTER (WHERE i.condition_status = 'functional') AS functional,
                 count(i.id) FILTER (WHERE i.condition_status = 'defective') AS defective
            FROM generate_series(v_today - 27, v_today, interval '1 day') AS g(day)
            LEFT JOIN inspections i
              ON i.inspector_id = v_uid
             AND (i.inspection_date AT TIME ZONE 'Asia/Manila')::date = g.day::date
           GROUP BY g.day
        ) d
      ),

      -- Defects found, by equipment type, in the last 7 and the last 28 days.
      'defects_by_type_7', (
        SELECT coalesce(json_agg(t ORDER BY t.count DESC, t.type), '[]'::json) FROM (
          SELECT e.equipment_type::text AS type, count(*) AS count
            FROM inspections i
            JOIN equipment e ON e.id = i.equipment_id
           WHERE i.inspector_id = v_uid
             AND i.condition_status = 'defective'
             AND (i.inspection_date AT TIME ZONE 'Asia/Manila')::date >= v_today - 6
           GROUP BY e.equipment_type
        ) t
      ),
      'defects_by_type_28', (
        SELECT coalesce(json_agg(t ORDER BY t.count DESC, t.type), '[]'::json) FROM (
          SELECT e.equipment_type::text AS type, count(*) AS count
            FROM inspections i
            JOIN equipment e ON e.id = i.equipment_id
           WHERE i.inspector_id = v_uid
             AND i.condition_status = 'defective'
             AND (i.inspection_date AT TIME ZONE 'Asia/Manila')::date >= v_today - 27
           GROUP BY e.equipment_type
        ) t
      )
    );
  END IF;

  IF v_role = 'technician' THEN
    SELECT t.id, t.is_available INTO v_tech, v_available
      FROM technicians t WHERE t.profile_id = v_uid LIMIT 1;

    RETURN json_build_object(
      'role', 'technician',
      'is_available', coalesce(v_available, true),
      -- Open jobs still on their plate (not started + working).
      'assigned', (SELECT count(*) FROM maintenance_actions
                    WHERE assigned_technician_id = v_tech AND status = 'in_progress'
                      AND coalesce(repair_status, 'assigned') <> 'repaired'),
      'working', (SELECT count(*) FROM maintenance_actions
                   WHERE assigned_technician_id = v_tech AND status = 'in_progress'
                     AND repair_status = 'working'),
      'awaiting_gso', (SELECT count(*) FROM maintenance_actions
                        WHERE assigned_technician_id = v_tech AND status = 'in_progress'
                          AND repair_status = 'repaired'),
      'completed', (SELECT count(*) FROM maintenance_actions
                     WHERE assigned_technician_id = v_tech AND status = 'completed'),

      -- Open jobs on their plate, by priority.
      'by_priority', (
        SELECT json_build_object(
                 'critical', count(*) FILTER (WHERE priority = 'critical'),
                 'high', count(*) FILTER (WHERE priority = 'high'),
                 'medium', count(*) FILTER (WHERE priority = 'medium'),
                 'low', count(*) FILTER (WHERE priority = 'low'))
          FROM maintenance_actions
         WHERE assigned_technician_id = v_tech AND status = 'in_progress'
           AND coalesce(repair_status, 'assigned') <> 'repaired'
      ),

      -- Jobs completed per day, oldest first, for the last 28 days.
      'done_days', (
        SELECT coalesce(json_agg(d ORDER BY d.day), '[]'::json) FROM (
          SELECT g.day::date AS day, count(m.id) AS count
            FROM generate_series(v_today - 27, v_today, interval '1 day') AS g(day)
            LEFT JOIN maintenance_actions m
              ON m.assigned_technician_id = v_tech
             AND m.status = 'completed'
             AND (m.completed_date::timestamptz AT TIME ZONE 'Asia/Manila')::date = g.day::date
           GROUP BY g.day
        ) d
      )
    );
  END IF;

  RAISE EXCEPTION 'Only inspector and technician accounts have these numbers.';
END $$;

REVOKE EXECUTE ON FUNCTION public.get_my_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_stats() TO authenticated;
