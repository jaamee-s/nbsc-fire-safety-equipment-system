-- ============================================================
-- Migration: building positions on the campus map (run after 024)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- The Buildings page's campus overview showed the buildings in a plain
-- grid. Now the GSO can arrange them like the real campus ("Arrange map"):
-- each building keeps the square it was placed on.
--
-- 1. buildings.map_col / map_row: the square on the campus map (column
--    1-8, row 1-12). Empty = not placed yet; the page puts it in the
--    first free square.
-- 2. Admins and managers may edit buildings (needed to save a position;
--    added under its own name, so any existing edit rule is untouched).
-- ============================================================

ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS map_col int;
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS map_row int;

ALTER TABLE public.buildings DROP CONSTRAINT IF EXISTS buildings_map_position_check;
ALTER TABLE public.buildings
  ADD CONSTRAINT buildings_map_position_check
  CHECK ((map_col IS NULL OR map_col BETWEEN 1 AND 8) AND (map_row IS NULL OR map_row BETWEEN 1 AND 12));

DROP POLICY IF EXISTS "Admins and managers can edit buildings" ON public.buildings;
CREATE POLICY "Admins and managers can edit buildings"
  ON public.buildings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                      AND p.role::text IN ('admin', 'manager')));
