-- ============================================================
-- Migration: fix notification messages (run after 002)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- Fixes: when GSO reassesses an Unresolved job, the web app now clears its
-- technician so a fresh Job Order can be filed. Migration 002 then told the
-- old technician "GSO assigned this job to another technician", which is
-- not what happened. Now:
--   - job reassessed (technician cleared)  -> old technician: "Job withdrawn"
--   - job given to someone else            -> old technician: "Job reassigned"
--   - new Job Order after a reassessment   -> technician: "New job order"
--     (even if it is the same technician as before)
-- Everything else is unchanged from 002.
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_on_maintenance_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_type text;
  v_where text;
  v_tech uuid;
  v_old_tech uuid;
BEGIN
  SELECT e.equipment_code,
         e.equipment_type,
         concat_ws(' — ', b.building_name, e.exact_location)
    INTO v_code, v_type, v_where
  FROM equipment e
  LEFT JOIN buildings b ON b.id = e.building_id
  WHERE e.id = NEW.equipment_id;
  v_code := coalesce(v_code, 'Equipment');

  IF NEW.assigned_technician_id IS NOT NULL THEN
    SELECT profile_id INTO v_tech FROM technicians WHERE id = NEW.assigned_technician_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_roles(
      NULL,
      'New defect reported: ' || v_code,
      initcap(coalesce(NEW.priority, 'medium')) || ' priority · ' || coalesce(NEW.description, '') ||
        CASE WHEN v_where <> '' THEN ' · ' || v_where ELSE '' END ||
        '. File a Job Order Request.',
      'new_defect', NEW.id
    );
    RETURN NEW;
  END IF;

  -- Job order assigned, reassigned or withdrawn
  IF NEW.assigned_technician_id IS DISTINCT FROM OLD.assigned_technician_id THEN
    IF NEW.assigned_technician_id IS NOT NULL THEN
      PERFORM notify_user(
        v_tech,
        'New job order: ' || v_code,
        coalesce(NEW.description, 'Repair needed') ||
          CASE WHEN v_where <> '' THEN ' · ' || v_where ELSE '' END ||
          CASE WHEN coalesce(NEW.job_order_remarks, '') <> '' THEN '. GSO says: "' || NEW.job_order_remarks || '"' ELSE '' END,
        'job_assigned', NEW.id
      );
    END IF;

    IF OLD.assigned_technician_id IS NOT NULL THEN
      SELECT profile_id INTO v_old_tech FROM technicians WHERE id = OLD.assigned_technician_id;
      IF v_old_tech IS DISTINCT FROM v_tech THEN
        IF NEW.assigned_technician_id IS NULL THEN
          PERFORM notify_user(
            v_old_tech,
            'Job withdrawn: ' || v_code,
            'GSO is reassessing this job. No further action needed from you unless it is assigned to you again.',
            'job_reassigned', NEW.id
          );
        ELSE
          PERFORM notify_user(
            v_old_tech,
            'Job reassigned: ' || v_code,
            'GSO assigned this job to another technician. No further action needed from you.',
            'job_reassigned', NEW.id
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Technician progress
  IF NEW.repair_status IS DISTINCT FROM OLD.repair_status THEN
    IF NEW.repair_status = 'working' THEN
      PERFORM notify_roles(
        NULL,
        'Technician started working on ' || v_code,
        coalesce(v_where, ''),
        'repair_working', NEW.id
      );
    ELSIF NEW.repair_status = 'repaired' THEN
      PERFORM notify_roles(
        NULL,
        'Repair finished: ' || v_code,
        CASE WHEN coalesce(NEW.repair_note, '') <> ''
             THEN 'Technician note: "' || NEW.repair_note || '"'
             ELSE coalesce(v_where, '') END,
        'repair_done', NEW.id
      );
    END IF;
  END IF;

  -- Job closed / unresolved
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'completed' THEN
      PERFORM notify_user(
        v_tech,
        'Job closed: ' || v_code,
        'The job is recorded as completed. Thank you for the repair.',
        'job_closed', NEW.id
      );
      PERFORM notify_roles(
        ARRAY['inspector'],
        CASE WHEN v_type = 'fire_extinguisher'
             THEN v_code || ' was replaced'
             ELSE v_code || ' is back in service' END,
        CASE WHEN v_type = 'fire_extinguisher'
             THEN 'The old unit is retired. Its replacement gets its own new code and sticker.'
             ELSE 'GSO closed the reported defect. This unit can be inspected again.' END ||
          CASE WHEN v_where <> '' THEN ' · ' || v_where ELSE '' END,
        'job_closed', NEW.id
      );
    ELSIF NEW.status = 'unresolved' THEN
      PERFORM notify_user(
        v_tech,
        'Job marked unresolved: ' || v_code,
        CASE WHEN coalesce(NEW.outcome_reason, '') <> ''
             THEN 'Reason: "' || NEW.outcome_reason || '"'
             ELSE 'GSO could not close this job yet.' END,
        'job_unresolved', NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.notify_on_maintenance_action() FROM PUBLIC, anon, authenticated;
