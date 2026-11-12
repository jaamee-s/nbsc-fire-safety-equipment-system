-- ============================================================
-- Migration: leave alerts + equipment overview (run after 012)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- 1. Live updates for staff_unavailability, so the admin's notification
--    bell shows new unavailable dates the moment they are sent.
--
-- 2. get_equipment_overview()
--    For the inspector's (and technician's) phone: per equipment type, the
--    installed units in service and how many were inspected this month,
--    counted exactly like the web Stock page:
--      total            units in service (not No Longer in Service)
--      functional       of those, Functional
--      needs_attention  of those, any other status
--      inspected        of those, units whose latest inspection is this
--                       month (Philippine time, from the 1st)
--      inspected_ok / inspected_bad   the result of that latest inspection
--      storeroom        new units in the GSO storeroom (Stock page)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'staff_unavailability'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_unavailability;
  END IF;
END $$;


CREATE OR REPLACE FUNCTION public.get_equipment_overview()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month_start date := date_trunc('month', (now() AT TIME ZONE 'Asia/Manila'))::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role::text IN ('inspector', 'technician', 'admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'This account cannot see the equipment overview.';
  END IF;

  RETURN (
    SELECT coalesce(json_agg(t ORDER BY t.equipment_type), '[]'::json)
    FROM (
      SELECT e.equipment_type::text AS equipment_type,
             count(*) AS total,
             count(*) FILTER (WHERE e.current_status::text = 'functional') AS functional,
             count(*) FILTER (WHERE e.current_status::text <> 'functional') AS needs_attention,
             count(*) FILTER (WHERE li.day >= v_month_start) AS inspected,
             count(*) FILTER (WHERE li.day >= v_month_start AND li.condition_status::text <> 'defective') AS inspected_ok,
             count(*) FILTER (WHERE li.day >= v_month_start AND li.condition_status::text = 'defective') AS inspected_bad,
             coalesce(max(s.quantity_available), 0) AS storeroom
      FROM equipment e
      LEFT JOIN LATERAL (
        SELECT (i.inspection_date AT TIME ZONE 'Asia/Manila')::date AS day, i.condition_status
        FROM inspections i
        WHERE i.equipment_id = e.id
        ORDER BY i.inspection_date DESC
        LIMIT 1
      ) li ON true
      LEFT JOIN equipment_stock s ON s.equipment_type::text = e.equipment_type::text
      WHERE e.current_status::text <> 'no_longer_in_service'
      GROUP BY e.equipment_type
    ) t
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.get_equipment_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_equipment_overview() TO authenticated;
