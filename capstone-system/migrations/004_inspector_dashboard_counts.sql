-- ============================================================
-- Migration: accurate inspector dashboard counts (run after 003)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- The 'due' and 'on_hold' lists are capped at 10 rows, so the app's
-- "Due for inspection" / "On hold" boxes could never show more than 10.
-- This adds, without changing any existing field:
--   due_count              real number of units due for inspection
--   never_inspected_count  real number of those never inspected
--   on_hold_count          real number of units on hold
--   open_defects           every unit on hold because of a defect THIS
--                          inspector reported (a unit on hold can't be
--                          inspected again, so its latest inspection is
--                          the report that put it on hold)
--   recent[].current_status  the unit's status NOW, so the app can show
--                          Fixed / Replaced / Still defective accurately
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_inspector_dashboard()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_day_start timestamptz :=
    (date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila');
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  select full_name into v_name from profiles where id = v_uid and role::text = 'inspector';
  if v_name is null then raise exception 'Only inspector accounts have this dashboard.'; end if;

  return json_build_object(
    'inspector_name', v_name,
    'today_count', (select count(*) from inspections where inspector_id = v_uid and inspection_date >= v_day_start),
    'week_count', (select count(*) from inspections where inspector_id = v_uid and inspection_date >= now() - interval '7 days'),
    'defect_count', (select count(*) from inspections where inspector_id = v_uid and condition_status = 'defective'),

    -- Real totals (the lists below are capped at 10 rows).
    'due_count', (
      select count(*) from equipment e
      where e.current_status not in ('no_longer_in_service', 'defective', 'for_repair', 'for_replacement')
    ),
    'never_inspected_count', (
      select count(*) from equipment e
      where e.current_status not in ('no_longer_in_service', 'defective', 'for_repair', 'for_replacement')
        and not exists (select 1 from inspections i where i.equipment_id = e.id)
    ),
    'on_hold_count', (
      select count(*) from equipment e
      where e.current_status in ('defective', 'for_repair', 'for_replacement')
    ),

    -- Units that can be inspected right now, longest since last check first.
    'due', (
      select coalesce(json_agg(t), '[]'::json) from (
        select e.id, e.equipment_code, e.equipment_type, e.exact_location, e.current_status,
               b.building_name,
               (select max(i.inspection_date) from inspections i where i.equipment_id = e.id) as last_inspected
        from equipment e
        left join buildings b on b.id = e.building_id
        where e.current_status not in ('no_longer_in_service', 'defective', 'for_repair', 'for_replacement')
        order by last_inspected asc nulls first
        limit 10
      ) t
    ),

    -- Units on hold because GSO has not resolved the reported defect.
    'on_hold', (
      select coalesce(json_agg(t), '[]'::json) from (
        select e.id, e.equipment_code, e.equipment_type, e.exact_location, e.current_status,
               b.building_name,
               (select max(i.inspection_date) from inspections i where i.equipment_id = e.id) as last_inspected
        from equipment e
        left join buildings b on b.id = e.building_id
        where e.current_status in ('defective', 'for_repair', 'for_replacement')
        order by last_inspected desc nulls last
        limit 10
      ) t
    ),

    -- Every unit still on hold because of a defect this inspector reported.
    'open_defects', (
      select coalesce(json_agg(t), '[]'::json) from (
        select li.id, li.inspection_date, li.condition_status, li.findings,
               e.equipment_code, e.current_status
        from equipment e
        join lateral (
          select i.id, i.inspection_date, i.condition_status, i.findings, i.inspector_id
          from inspections i
          where i.equipment_id = e.id
          order by i.inspection_date desc
          limit 1
        ) li on true
        where e.current_status in ('defective', 'for_repair', 'for_replacement')
          and li.condition_status = 'defective'
          and li.inspector_id = v_uid
        order by li.inspection_date desc
      ) t
    ),

    'recent', (
      select coalesce(json_agg(r), '[]'::json) from (
        select i.id, i.inspection_date, i.condition_status, i.findings, e.equipment_code,
               e.current_status
        from inspections i
        join equipment e on e.id = i.equipment_id
        where i.inspector_id = v_uid
        order by i.inspection_date desc
        limit 10
      ) r
    )
  );
end;
$function$;
