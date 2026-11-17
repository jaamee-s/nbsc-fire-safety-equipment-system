-- ============================================================
-- Migration: let admins edit a room's name (run after 017)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- building_locations had rules to add, read and delete rooms, but none to
-- edit one, so renaming a room (e.g. when an office moves) did nothing.
-- This adds the edit rule for admins and managers only, the same check
-- as adding and deleting rooms.
-- ============================================================

DROP POLICY IF EXISTS "Admins and managers can update building_locations" ON public.building_locations;
CREATE POLICY "Admins and managers can update building_locations"
  ON public.building_locations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                      AND p.role::text IN ('admin', 'manager')));
