-- ============================================================
-- Migration: inspection assignments (run after 009)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- The admin assigns an inspector a building (or one floor of it) to
-- inspect, with a due date and a priority — the inspector's "job order".
-- From the web Inspectors page: "Assign inspection" on an inspector's card.
--
--   inspection_assignments   one row per assignment
--   - the admin (admin / manager) can create, read and cancel them
--   - an inspector can read their own
--   - the inspector gets a notification (and a push to the phone)
--
-- Progress is not stored: the web counts it live from the inspections the
-- inspector submitted for units in that building/floor after the
-- assignment was made.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.inspection_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  floor_label text,                       -- NULL = the whole building
  due_date date NOT NULL,
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  notes text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'cancelled')),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inspection_assignments_inspector_idx
  ON public.inspection_assignments (inspector_id, status);

ALTER TABLE public.inspection_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage inspection assignments" ON public.inspection_assignments;
CREATE POLICY "admins manage inspection assignments"
  ON public.inspection_assignments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::text IN ('admin', 'manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::text IN ('admin', 'manager')));

DROP POLICY IF EXISTS "inspectors read their own assignments" ON public.inspection_assignments;
CREATE POLICY "inspectors read their own assignments"
  ON public.inspection_assignments
  FOR SELECT TO authenticated
  USING (inspector_id = auth.uid());

-- Only an inspector account can be given an inspection assignment.
CREATE OR REPLACE FUNCTION public.check_inspection_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = NEW.inspector_id AND role::text = 'inspector') THEN
    RAISE EXCEPTION 'Inspection assignments can only be given to inspector accounts.';
  END IF;
  IF NEW.floor_label IS NOT NULL AND trim(NEW.floor_label) = '' THEN
    NEW.floor_label := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS check_inspection_assignment ON public.inspection_assignments;
CREATE TRIGGER check_inspection_assignment
  BEFORE INSERT OR UPDATE ON public.inspection_assignments
  FOR EACH ROW EXECUTE FUNCTION public.check_inspection_assignment();

-- Tell the inspector (notification row + push, via notify_user from 002).
CREATE OR REPLACE FUNCTION public.notify_on_inspection_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_building text;
BEGIN
  SELECT building_name INTO v_building FROM buildings WHERE id = NEW.building_id;
  v_building := coalesce(v_building, 'a building') ||
                CASE WHEN NEW.floor_label IS NOT NULL THEN ' — ' || NEW.floor_label ELSE '' END;

  IF TG_OP = 'INSERT' THEN
    PERFORM notify_user(
      NEW.inspector_id,
      'New inspection assignment: ' || v_building,
      initcap(NEW.priority) || ' priority · due ' || to_char(NEW.due_date, 'Mon DD, YYYY') ||
        CASE WHEN coalesce(NEW.notes, '') <> '' THEN '. GSO says: "' || NEW.notes || '"' ELSE '' END,
      'inspection_assigned', NULL
    );
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    PERFORM notify_user(
      NEW.inspector_id,
      'Inspection assignment cancelled: ' || v_building,
      'The GSO cancelled this assignment. No action needed.',
      'inspection_cancelled', NULL
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_on_inspection_assignment ON public.inspection_assignments;
CREATE TRIGGER notify_on_inspection_assignment
  AFTER INSERT OR UPDATE ON public.inspection_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_inspection_assignment();

REVOKE EXECUTE ON FUNCTION public.check_inspection_assignment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_inspection_assignment() FROM PUBLIC, anon, authenticated;
