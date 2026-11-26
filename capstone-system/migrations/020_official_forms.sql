-- ============================================================
-- Migration: NBSC official forms (run after 019)
--   Job Order Request  FM-NBSC-GSO-004
--   Purchase Request   FM-NBSC-PMO-003
-- Run in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Safe to run more than once.
--
-- Stores the data printed on the two official paper forms, so the GSO can
-- fill them in on the dashboard and print them on A4.
--
-- 1. job_order_requests: one row per Job Order, filled in on the official
--    layout when the GSO submits the Job Order:
--      - repair: assigns a technician to a defect. source_record_id =
--        that Priority Action (maintenance_actions.id);
--      - inspection: assigns a building / floor to an inspector.
--        inspection_assignment_id = that assignment
--        (inspection_assignments.id).
--
-- 2. purchase_requests + purchase_request_items: created when the GSO
--    clicks "Create Purchase Request form" on equipment listed under
--    "Needs Purchase Request". source_record_id = that equipment
--    (equipment.id); expired units on that list have no Priority Action,
--    so the equipment is the record every Purchase Request has.
--    total_amount is computed by the database (quantity * unit_cost), and
--    the grand total is in the purchase_request_totals view.
--
-- 3. Only admin and manager accounts can read or change these (the same
--    rule as the other GSO records in migration 015). Rows are never
--    deleted from the app; PR item lines can be removed while editing.
--
-- If the linked Priority Action or equipment is deleted, the form is kept
-- and only its link is cleared.
-- ============================================================

-- updated_at kept current on every edit
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- 1. Job Order Request
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_order_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jor_no                  text UNIQUE,                  -- assigned by the GSO
  source_record_id        uuid,                         -- maintenance_actions.id (repair)
  inspection_assignment_id uuid,                        -- inspection_assignments.id (inspection)

  -- requester
  name                    text NOT NULL,
  position                text,
  department_unit         text,
  date_of_filing          date NOT NULL DEFAULT current_date,
  immediate_supervisor    text,
  contact_no              text,

  -- type of job order request
  request_type            text NOT NULL
    CHECK (request_type IN ('repair', 'corrective_maintenance', 'emergency',
                            'inspection', 'hauling', 'others')),
  request_type_other      text,
  location_from           text,
  office_room_to          text,
  nature_of_work          text
    CHECK (nature_of_work IN ('easy', 'complex', 'highly_technical')),
  description             text NOT NULL,

  -- GSO processing
  acknowledged_by         text,                         -- GSO Staff
  remarks                 text,
  action_taken            text CHECK (action_taken IN ('approved', 'disapproved')),
  action_reason           text,
  gso_head_name           text,                         -- Head, General Services Office
  facilitated_by          text,

  -- end-user completion confirmation
  completion_confirmed_by text,
  completed_at            timestamptz,
  completion_remarks      text,

  status                  text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'disapproved', 'completed')),
  created_by              uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jor_others_needs_text
    CHECK (request_type <> 'others' OR coalesce(trim(request_type_other), '') <> ''),
  CONSTRAINT jor_disapproved_needs_reason
    CHECK (action_taken IS DISTINCT FROM 'disapproved' OR coalesce(trim(action_reason), '') <> '')
);

ALTER TABLE public.job_order_requests ADD COLUMN IF NOT EXISTS inspection_assignment_id uuid;

ALTER TABLE public.job_order_requests DROP CONSTRAINT IF EXISTS jor_source_fk;
ALTER TABLE public.job_order_requests
  ADD CONSTRAINT jor_source_fk FOREIGN KEY (source_record_id)
  REFERENCES public.maintenance_actions(id) ON DELETE SET NULL;

ALTER TABLE public.job_order_requests DROP CONSTRAINT IF EXISTS jor_inspection_assignment_fk;
ALTER TABLE public.job_order_requests
  ADD CONSTRAINT jor_inspection_assignment_fk FOREIGN KEY (inspection_assignment_id)
  REFERENCES public.inspection_assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jor_source_idx ON public.job_order_requests (source_record_id);
CREATE INDEX IF NOT EXISTS jor_inspection_assignment_idx ON public.job_order_requests (inspection_assignment_id);
CREATE INDEX IF NOT EXISTS jor_status_idx ON public.job_order_requests (status);

DROP TRIGGER IF EXISTS jor_set_updated_at ON public.job_order_requests;
CREATE TRIGGER jor_set_updated_at BEFORE UPDATE ON public.job_order_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Purchase Request (header + item lines)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_no                       text UNIQUE,              -- assigned by Supply / PMO
  source_record_id            uuid,                     -- equipment.id

  entity_name                 text NOT NULL DEFAULT 'Northern Bukidnon State College',
  fund_cluster                text,
  office_section              text,
  responsibility_center_code  text,
  pr_date                     date NOT NULL DEFAULT current_date,
  purpose                     text,

  requested_by_name           text,
  requested_by_designation    text,
  requested_date              date,
  approved_by_name            text,                     -- SUC President I
  approved_date               date,

  status                      text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'cancelled')),
  created_by                  uuid DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_requests DROP CONSTRAINT IF EXISTS pr_source_fk;
ALTER TABLE public.purchase_requests
  ADD CONSTRAINT pr_source_fk FOREIGN KEY (source_record_id)
  REFERENCES public.equipment(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pr_source_idx ON public.purchase_requests (source_record_id);

DROP TRIGGER IF EXISTS pr_set_updated_at ON public.purchase_requests;
CREATE TRIGGER pr_set_updated_at BEFORE UPDATE ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.purchase_request_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id  uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  line_no              int  NOT NULL CHECK (line_no > 0),
  stock_property_no    text,
  unit                 text NOT NULL,                   -- pc, unit, set, box...
  item_description     text NOT NULL,
  quantity             numeric(12,2) NOT NULL CHECK (quantity > 0),
  unit_cost            numeric(12,2) NOT NULL CHECK (unit_cost >= 0),
  total_amount         numeric(14,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  UNIQUE (purchase_request_id, line_no)
);

-- Grand total per Purchase Request (computed, so it can't drift)
CREATE OR REPLACE VIEW public.purchase_request_totals
WITH (security_invoker = true) AS
SELECT purchase_request_id,
       sum(total_amount)::numeric(14,2) AS grand_total,
       count(*) AS item_count
  FROM public.purchase_request_items
 GROUP BY purchase_request_id;

-- ------------------------------------------------------------
-- 3. Row Level Security: admin and manager accounts only
-- ------------------------------------------------------------
ALTER TABLE public.job_order_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  is_gso text := 'EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() '
                 'AND p.role::text IN (''admin'', ''manager''))';
BEGIN
  FOREACH t IN ARRAY ARRAY['job_order_requests', 'purchase_requests', 'purchase_request_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "GSO can read %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "GSO can add %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "GSO can edit %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "GSO can read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (%2$s)', t, is_gso);
    EXECUTE format('CREATE POLICY "GSO can add %1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (%2$s)', t, is_gso);
    EXECUTE format('CREATE POLICY "GSO can edit %1$s" ON public.%1$I FOR UPDATE TO authenticated USING (%2$s) WITH CHECK (%2$s)', t, is_gso);
  END LOOP;

  -- Item lines can be removed while editing a Purchase Request.
  DROP POLICY IF EXISTS "GSO can remove purchase_request_items" ON public.purchase_request_items;
  EXECUTE format('CREATE POLICY "GSO can remove purchase_request_items" ON public.purchase_request_items FOR DELETE TO authenticated USING (%s)', is_gso);
END $$;
