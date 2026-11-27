-- ============================================================
-- Migration: change log of admin edits (run after 022)
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- Every time an admin or manager adds, edits or deletes a record in the
-- main tables, one row is written here: who did it, when, which record,
-- and for an edit, each field's old and new value. Inspectors' and
-- technicians' own actions already leave records (inspections, repair
-- updates), so only admin / manager changes are logged.
--
-- 1. change_log: the log. Admins and managers can read it; nobody can
--    add, edit or delete rows from the apps (only the trigger writes).
-- 2. log_admin_change(): the trigger function.
-- 3. The trigger on each table the GSO manages.
-- ============================================================

-- 1. The log
CREATE TABLE IF NOT EXISTS public.change_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  actor_name  text,
  actor_role  text,
  table_name  text NOT NULL,
  row_id      text,
  row_label   text,                 -- e.g. the equipment code or building name
  action      text NOT NULL CHECK (action IN ('added', 'edited', 'deleted')),
  changes     jsonb                 -- edited: { field: [old, new] }; added / deleted: the row
);

CREATE INDEX IF NOT EXISTS change_log_changed_at_idx ON public.change_log (changed_at DESC);

ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and managers can read the change log" ON public.change_log;
CREATE POLICY "Admins and managers can read the change log"
  ON public.change_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                 AND p.role::text IN ('admin', 'manager')));

-- 2. The trigger function
CREATE OR REPLACE FUNCTION public.log_admin_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_row jsonb := coalesce(v_new, v_old);
  v_changes jsonb := '{}'::jsonb;
  k text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT full_name, role::text INTO v_name, v_role FROM profiles WHERE id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'manager') THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF k NOT IN ('updated_at') AND (v_old -> k) IS DISTINCT FROM (v_new -> k) THEN
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      END IF;
    END LOOP;
    -- Saving a record without changing anything is not a change.
    IF v_changes = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSE
    v_changes := v_row;
  END IF;

  INSERT INTO change_log (actor_id, actor_name, actor_role, table_name, row_id, row_label, action, changes)
  VALUES (
    v_uid,
    v_name,
    v_role,
    TG_TABLE_NAME,
    coalesce(v_row ->> 'id', v_row ->> 'equipment_type'),
    coalesce(
      v_row ->> 'equipment_code', v_row ->> 'building_name', v_row ->> 'location_label',
      v_row ->> 'full_name', v_row ->> 'jor_no', v_row ->> 'pr_no', v_row ->> 'item_description',
      v_row ->> 'equipment_type', v_row ->> 'description'
    ),
    CASE TG_OP WHEN 'INSERT' THEN 'added' WHEN 'UPDATE' THEN 'edited' ELSE 'deleted' END,
    v_changes
  );
  RETURN NULL;
END $$;

-- 3. The trigger on each table the GSO manages (only tables that exist)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'equipment', 'buildings', 'building_locations', 'equipment_stock', 'technicians',
    'profiles', 'maintenance_actions', 'inspection_assignments',
    'job_order_requests', 'purchase_requests', 'purchase_request_items'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS log_admin_change ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER log_admin_change AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.log_admin_change()', t);
    END IF;
  END LOOP;
END $$;
