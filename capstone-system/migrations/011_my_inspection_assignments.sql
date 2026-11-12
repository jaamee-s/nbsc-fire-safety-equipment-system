-- ============================================================
-- Migration: the inspector's job orders on the phone (run after 010)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- get_my_inspection_assignments()
--   The signed-in inspector's open inspection assignments (job orders),
--   each with the units it covers and whether this inspector has
--   inspected each one since the assignment was made. Counted exactly
--   like the web Inspectors page:
--     - units: in service, in that building (and on that floor if one was
--       picked; a unit's floor is the part of exact_location before " - "),
--       already there when the job order was given
--     - inspected: an inspection by this inspector after created_at
--     - on hold: not inspected yet and waiting for the GSO (defective /
--       for repair / for replacement) — can't be inspected, doesn't block
--   Finished assignments (every unit not on hold inspected) are left out.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_inspection_assignments()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Please sign in.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND role::text = 'inspector') THEN
    RAISE EXCEPTION 'Only inspector accounts have inspection job orders.';
  END IF;

  RETURN (
    SELECT coalesce(json_agg(x ORDER BY x.priority_rank, x.due_date, x.created_at), '[]'::json)
    FROM (
      SELECT a.id, a.building_id, b.building_name, a.floor_label, a.due_date, a.priority,
             a.notes, a.created_by, a.created_at,
             CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END AS priority_rank,
             u.units,
             u.done,
             u.on_hold,
             u.total
      FROM inspection_assignments a
      JOIN buildings b ON b.id = a.building_id
      CROSS JOIN LATERAL (
        SELECT coalesce(json_agg(json_build_object(
                 'id', e.id,
                 'equipment_code', e.equipment_code,
                 'equipment_type', e.equipment_type,
                 'exact_location', e.exact_location,
                 'current_status', e.current_status,
                 'inspected', e.inspected
               ) ORDER BY e.inspected, e.exact_location, e.equipment_code), '[]'::json) AS units,
               count(*) FILTER (WHERE e.inspected) AS done,
               count(*) FILTER (WHERE NOT e.inspected AND e.on_hold) AS on_hold,
               count(*) FILTER (WHERE e.inspected OR NOT e.on_hold) AS total
        FROM (
          SELECT eq.*,
                 EXISTS (
                   SELECT 1 FROM inspections i
                   WHERE i.equipment_id = eq.id
                     AND i.inspector_id = v_uid
                     AND i.inspection_date >= a.created_at
                 ) AS inspected,
                 eq.current_status::text IN ('defective', 'for_repair', 'for_replacement') AS on_hold
          FROM equipment eq
          WHERE eq.building_id = a.building_id
            AND eq.current_status::text <> 'no_longer_in_service'
            AND (a.floor_label IS NULL OR eq.exact_location LIKE a.floor_label || ' - %')
            -- units installed after the job order was given are not part of it
            AND (eq.created_at IS NULL OR eq.created_at <= a.created_at)
        ) e
      ) u
      WHERE a.inspector_id = v_uid
        AND a.status = 'open'
    ) x
    WHERE NOT (x.total > 0 AND x.done >= x.total)
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.get_my_inspection_assignments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_inspection_assignments() TO authenticated;
