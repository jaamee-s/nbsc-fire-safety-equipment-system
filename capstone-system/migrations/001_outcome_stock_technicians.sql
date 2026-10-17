-- ============================================================
-- Migration: Work Outcome Tracking + Stock + Technicians
-- Run in Supabase SQL Editor before deploying code changes.
-- ============================================================

-- 1. Add outcome tracking columns to maintenance_actions
ALTER TABLE maintenance_actions
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS outcome_reason text,
  ADD COLUMN IF NOT EXISTS outcome_by text,
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_technician_id uuid;

-- Update the status check constraint to include 'unresolved'
-- (drop existing constraint first — name may vary across environments)
DO $$
BEGIN
  BEGIN
    ALTER TABLE maintenance_actions DROP CONSTRAINT IF EXISTS maintenance_actions_status_check;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE maintenance_actions DROP CONSTRAINT IF EXISTS valid_status;
  EXCEPTION WHEN undefined_object THEN NULL;
  END;
END $$;

ALTER TABLE maintenance_actions
  ADD CONSTRAINT maintenance_actions_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed', 'delayed', 'for_disposal', 'unresolved'));


-- 2. Equipment stock table
CREATE TABLE IF NOT EXISTS equipment_stock (
  equipment_type text PRIMARY KEY,
  quantity_available integer NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  updated_at timestamptz DEFAULT now(),
  updated_by text
);

-- Seed with all equipment types at 0
INSERT INTO equipment_stock (equipment_type, quantity_available)
VALUES
  ('fire_extinguisher', 0),
  ('fire_alarm', 0),
  ('sprinkler', 0),
  ('emergency_light', 0),
  ('smoke_detector', 0)
ON CONFLICT (equipment_type) DO NOTHING;

-- RLS for equipment_stock
ALTER TABLE equipment_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stock"
  ON equipment_stock FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin/manager can update stock"
  ON equipment_stock FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );


-- 3. Technicians table
CREATE TABLE IF NOT EXISTS technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  contact_info text,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- RLS for technicians
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read technicians"
  ON technicians FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admin/manager can insert technicians"
  ON technicians FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admin/manager can update technicians"
  ON technicians FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Admin/manager can delete technicians"
  ON technicians FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- FK from maintenance_actions to technicians (nullable)
ALTER TABLE maintenance_actions
  ADD CONSTRAINT fk_assigned_technician
  FOREIGN KEY (assigned_technician_id)
  REFERENCES technicians(id)
  ON DELETE SET NULL;

