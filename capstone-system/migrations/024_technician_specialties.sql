-- ============================================================
-- Migration: technician specialties (run after 023)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- GSO feedback: the technician (an electrician) handles equipment with
-- electrical parts, not fire extinguishers. Each technician now has the
-- kinds of work they handle, and the Job Order window shows who fits:
--   electrical    fire alarms, emergency lights, smoke detectors
--   extinguisher  fire extinguisher refill / replacement
--   sprinkler     sprinklers and plumbing
--   general       general repairs, any equipment
-- An empty list means "not set yet": the technician fits no job in
-- particular and is still listed. The admin edits it on the Technicians
-- page (the same rule as editing a technician's name and contact).
-- ============================================================

ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS specialties text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.technicians DROP CONSTRAINT IF EXISTS technicians_specialties_check;
ALTER TABLE public.technicians
  ADD CONSTRAINT technicians_specialties_check
  CHECK (specialties <@ ARRAY['electrical', 'extinguisher', 'sprinkler', 'general']::text[]);
