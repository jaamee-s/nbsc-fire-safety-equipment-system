-- ============================================================
-- Migration: live updates for every table the dashboard watches
-- (run after 015)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- Supabase only sends live changes for tables added to the
-- "supabase_realtime" publication. Earlier migrations added only
-- notifications, technicians and staff_unavailability, so new defects,
-- repair updates and inspections reached the GSO dashboard only after a
-- page reload.
--
-- This adds every table the web dashboard listens to. Who may see each
-- change is still decided by the same Row Level Security rules as normal
-- reads (migration 015), so nothing new becomes visible to anyone.
--
-- The last statement lists the tables that are live afterwards.
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'maintenance_actions',
    'inspections',
    'equipment',
    'equipment_stock',
    'technicians',
    'staff_unavailability',
    'inspection_assignments',
    'notifications'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Live updates turned on for %', t;
    END IF;
  END LOOP;
END $$;

SELECT tablename AS live_tables
  FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
 ORDER BY tablename;
