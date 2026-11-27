-- ============================================================
-- Migration: "For disposal" result, scanned / typed code, and the real
-- time of offline inspections (run after 025)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- 1. For disposal (client request): a disposable fire extinguisher that is
--    used, expired or damaged can't be refilled. The inspector still scans
--    it, then picks "For disposal". That saves the inspection and creates a
--    Priority Action with status 'for_disposal' (disposition 'dispose') for
--    the GSO, and puts the unit on hold ('for_replacement') until the GSO
--    records the disposal. Fire extinguishers only.
-- 2. Scanned or typed: each inspection records how the unit was found.
--    Typing the code is still allowed for damaged stickers, but the inspector
--    says why, and the GSO sees "Code typed" on the inspection.
-- 3. Offline inspections (sent later from the phone) keep the time they were
--    really done: p_inspected_at, accepted up to 30 days back and never in
--    the future (otherwise the time it arrives is used).
--
-- submit_inspector_inspection() is the function that was in the database,
-- with these three additions. Its old 7 inputs still work, so phones on the
-- previous app keep inspecting as before.
-- ============================================================

-- New columns on inspections
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS entry_method text;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS typed_reason text;

ALTER TABLE public.inspections DROP CONSTRAINT IF EXISTS inspections_entry_method_check;
ALTER TABLE public.inspections
  ADD CONSTRAINT inspections_entry_method_check CHECK (entry_method IS NULL OR entry_method IN ('scanned', 'typed'));

-- "For disposal" as an inspection result
ALTER TABLE public.inspections DROP CONSTRAINT IF EXISTS inspections_condition_status_check;
ALTER TABLE public.inspections
  ADD CONSTRAINT inspections_condition_status_check
  CHECK (condition_status = ANY (ARRAY['functional'::text, 'defective'::text, 'for_disposal'::text]));

-- The function: the old one is replaced (same name, three new optional inputs)
DROP FUNCTION IF EXISTS public.submit_inspector_inspection(uuid, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_inspector_inspection(
  p_equipment_id uuid,
  p_condition_status text,
  p_findings text,
  p_recommended_action text,
  p_inspection_notes text,
  p_action_type text,
  p_priority text,
  p_entry_method text DEFAULT NULL,
  p_typed_reason text DEFAULT NULL,
  p_inspected_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_inspection_id uuid;
  v_is_defective boolean;
  v_is_disposal boolean;
  v_current_status text;
  v_type text;
  v_when timestamptz;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;

  select full_name into v_name from profiles where id = v_uid and role::text = 'inspector';
  if v_name is null then raise exception 'Only inspector accounts can submit inspections.'; end if;

  if p_condition_status not in ('functional', 'defective', 'for_disposal') then
    raise exception 'Invalid condition_status';
  end if;
  if p_entry_method is not null and p_entry_method not in ('scanned', 'typed') then
    raise exception 'Invalid entry method';
  end if;
  if p_entry_method = 'typed' and nullif(trim(coalesce(p_typed_reason, '')), '') is null then
    raise exception 'Say why the code was typed instead of scanned.';
  end if;

  select current_status, equipment_type into v_current_status, v_type from equipment where id = p_equipment_id;
  if not found then raise exception 'Equipment not found'; end if;

  if v_current_status = 'no_longer_in_service' then
    raise exception 'This equipment has been retired and can no longer be inspected.';
  end if;

  -- A reported defect must be handled by GSO first. Inspection is on hold
  -- until GSO records the outcome and the unit is Functional again.
  if v_current_status in ('defective', 'for_repair', 'for_replacement') then
    raise exception 'This equipment has a reported defect that GSO has not resolved yet. Inspection is on hold until GSO records the outcome.';
  end if;

  v_is_defective := (p_condition_status = 'defective');
  v_is_disposal := (p_condition_status = 'for_disposal');

  if v_is_disposal and v_type <> 'fire_extinguisher' then
    raise exception 'Only a fire extinguisher can be reported for disposal.';
  end if;

  -- The real time of an inspection done offline, within reason.
  v_when := case
    when p_inspected_at is not null and p_inspected_at <= now() and p_inspected_at >= now() - interval '30 days'
      then p_inspected_at
    else now()
  end;

  insert into inspections (
    equipment_id, condition_status, findings, action_required,
    recommended_action, inspection_notes, inspector_name, inspector_id,
    inspection_date, entry_method, typed_reason
  )
  values (
    p_equipment_id, p_condition_status, p_findings, (v_is_defective or v_is_disposal),
    p_recommended_action, p_inspection_notes, v_name, v_uid,
    v_when, p_entry_method, nullif(trim(coalesce(p_typed_reason, '')), '')
  )
  returning id into v_inspection_id;

  update equipment
  set current_status = case
    when v_is_defective then 'defective'
    when v_is_disposal then 'for_replacement'
    else 'functional'
  end
  where id = p_equipment_id;

  if v_is_defective then
    insert into maintenance_actions (
      equipment_id, inspection_id, action_type, description, priority, status
    )
    values (
      p_equipment_id, v_inspection_id, coalesce(p_action_type, 'other'),
      coalesce(p_recommended_action, p_findings, 'Action needed'),
      coalesce(p_priority, 'medium'), 'pending'
    );
  elsif v_is_disposal then
    insert into maintenance_actions (
      equipment_id, inspection_id, action_type, description, priority, status, disposition
    )
    values (
      p_equipment_id, v_inspection_id, 'replace',
      coalesce(p_findings, 'Disposable extinguisher for disposal'),
      coalesce(p_priority, 'high'), 'for_disposal', 'dispose'
    );
  end if;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.submit_inspector_inspection(uuid, text, text, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_inspector_inspection(uuid, text, text, text, text, text, text, text, text, timestamptz) TO authenticated;
