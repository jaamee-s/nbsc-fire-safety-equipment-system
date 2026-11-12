-- ============================================================
-- Migration: unavailable dates (run after 011)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- Inspectors and technicians set, in the mobile app, the dates they will
-- be unavailable (leave, training, ...). The admin sees them on the web
-- Inspectors / Technicians cards (calendar button).
--
--   staff_unavailability   one row per date range (start_date..end_date)
--   - each inspector / technician adds, sees and removes their own
--   - admin accounts (admin / manager) can see everyone's
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_unavailability_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS staff_unavailability_profile_idx
  ON public.staff_unavailability (profile_id, start_date);

ALTER TABLE public.staff_unavailability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read own unavailable dates" ON public.staff_unavailability;
CREATE POLICY "staff read own unavailable dates"
  ON public.staff_unavailability FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "staff add own unavailable dates" ON public.staff_unavailability;
CREATE POLICY "staff add own unavailable dates"
  ON public.staff_unavailability FOR INSERT TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::text IN ('inspector', 'technician'))
  );

DROP POLICY IF EXISTS "staff remove own unavailable dates" ON public.staff_unavailability;
CREATE POLICY "staff remove own unavailable dates"
  ON public.staff_unavailability FOR DELETE TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "admins read unavailable dates" ON public.staff_unavailability;
CREATE POLICY "admins read unavailable dates"
  ON public.staff_unavailability FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role::text IN ('admin', 'manager')));
