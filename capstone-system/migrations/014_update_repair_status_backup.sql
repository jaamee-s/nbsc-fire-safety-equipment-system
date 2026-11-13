-- ============================================================
-- Migration: update_repair_status (backup copy, run after 013)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- This function was created directly in Supabase and had no copy in the
-- project. It is saved here exactly as it is live (2026-11-13), so it is
-- backed up and can be recreated. Running it changes nothing.
--
-- update_repair_status(p_action_id, p_repair_status, p_note)
--   Called by the technician's phone. Records "Working on it" or
--   "Marked repaired", the note and the repair time. Only the technician
--   assigned to the job can update it, and only while it is In Progress.
--   Closing the job, retiring a fire extinguisher and taking a unit from
--   stock happen on the web when GSO records the outcome as Resolved.
-- ============================================================

create or replace function public.update_repair_status(p_action_id uuid, p_repair_status text, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_tech uuid;
  v_updated int;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if p_repair_status not in ('working', 'repaired') then
    raise exception 'Invalid repair status.';
  end if;

  select t.id into v_tech
  from technicians t
  join profiles p on p.id = t.profile_id
  where t.profile_id = v_uid and p.role::text = 'technician';
  if v_tech is null then raise exception 'Only technician accounts can update repairs.'; end if;

  update maintenance_actions
  set repair_status = p_repair_status,
      repair_note = nullif(trim(coalesce(p_note, '')), ''),
      repaired_at = case when p_repair_status = 'repaired' then now() else null end
  where id = p_action_id
    and assigned_technician_id = v_tech
    and status = 'in_progress';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'This job is not assigned to you, or it is no longer in progress.';
  end if;
end;
$function$;
