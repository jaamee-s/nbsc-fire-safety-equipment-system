/**
 * InspectorModule.reference.js
 *
 * NOT USED BY THE WEB APP. This file is a reference for building the
 * Android Inspector app (React Native / Expo) later.
 *
 * DESIGN NOTES
 * ------------
 * 1. No login. Per the panel's guidance, the app itself is the access control:
 *    it is only installed on GSO-issued inspector devices. There is no auth
 *    screen and no Supabase session.
 *
 * 2. Because there is no logged-in user, the app connects with the public
 *    anon key. It therefore CANNOT write directly to any table — the RLS
 *    policies require an authenticated role for inserts.
 *
 * 3. All writes go through ONE server-side function:
 *       submit_inspector_inspection(...)
 *    It is `security definer`, validates its inputs, and performs the whole
 *    3-step submission atomically. Even if someone extracts the anon key from
 *    the APK, this single narrow function is all they can reach.
 *
 * 4. Accountability comes from `inspector_name`, collected once on first
 *    launch and stored on the device. The database rejects a blank name.
 *    This is identity WITHOUT authentication — a deliberate tradeoff, and
 *    worth stating plainly during the defense.
 */

import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ---------------------------------------------------------------------------
// Supabase client (React Native)
// ---------------------------------------------------------------------------

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      // No sessions: this app never logs anyone in.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
)

// ---------------------------------------------------------------------------
// Constants — these MUST match the database check constraints exactly.
// Lowercase with underscores. A mismatch is silently rejected by Postgres.
// ---------------------------------------------------------------------------

export const CONDITION_OPTIONS = ['functional', 'defective']

export const ACTION_TYPES = [
  'repair',
  'replace',
  'battery_replacement',
  'refill',
  'inspection',
  'other'
]

export const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'critical']

export const CONDITION_LABELS = {
  functional: 'Functional',
  defective: 'Defective'
}

export const ACTION_TYPE_LABELS = {
  repair: 'Repair',
  replace: 'Replace',
  battery_replacement: 'Battery Replacement',
  refill: 'Refill',
  inspection: 'Inspection',
  other: 'Other'
}

// Recommended action per equipment type, taken from the flowcharts.
// Use these to pre-select a sensible default once the QR scan identifies
// the equipment type — the inspector can still override.
export const DEFAULT_ACTION_BY_TYPE = {
  fire_extinguisher: 'refill',
  smoke_detector: 'battery_replacement',
  emergency_light: 'battery_replacement',
  fire_alarm: 'repair',
  sprinkler: 'repair'
}

// ---------------------------------------------------------------------------
// Inspector identity — collected once, stored on the device.
// ---------------------------------------------------------------------------

const INSPECTOR_NAME_KEY = 'nbsc_inspector_name'

export async function getStoredInspectorName() {
  try {
    return await AsyncStorage.getItem(INSPECTOR_NAME_KEY)
  } catch (err) {
    console.error('Could not read inspector name:', err)
    return null
  }
}

export async function saveInspectorName(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new Error('Inspector name cannot be empty.')
  await AsyncStorage.setItem(INSPECTOR_NAME_KEY, trimmed)
  return trimmed
}

// ---------------------------------------------------------------------------
// QR lookup — find the equipment a scanned code belongs to.
// Anonymous SELECT on equipment/buildings is allowed by policy.
// ---------------------------------------------------------------------------

export async function findEquipmentByQrCode(scannedValue) {
  const { data, error } = await supabase
    .from('equipment')
    .select(`
      id, equipment_code, equipment_type, exact_location,
      current_status, expiration_date,
      buildings ( building_name )
    `)
    .eq('qr_code', scannedValue)
    .maybeSingle()

  if (error) throw new Error('Lookup failed: ' + error.message)
  if (!data) throw new Error('No equipment matches this QR code.')

  return data
}

// ---------------------------------------------------------------------------
// Submission — the single write path.
//
// The function handles all three steps server-side:
//   1. insert into inspections (with inspector_name)
//   2. update equipment.current_status
//   3. if defective, create a pending maintenance_actions row for GSO
//
// Do NOT try to do these as three separate client calls. They would fail
// on RLS, and a partial write would leave the data inconsistent.
// ---------------------------------------------------------------------------

export async function submitInspection({
  equipmentId,
  conditionStatus,
  findings,
  recommendedAction,
  inspectionNotes,
  actionType,
  priority,
  inspectorName
}) {
  if (!CONDITION_OPTIONS.includes(conditionStatus)) {
    throw new Error('Condition must be "functional" or "defective".')
  }

  if (!inspectorName || !inspectorName.trim()) {
    throw new Error('Inspector name is required.')
  }

  const { error } = await supabase.rpc('submit_inspector_inspection', {
    p_equipment_id: equipmentId,
    p_condition_status: conditionStatus,
    p_findings: findings || null,
    p_recommended_action: recommendedAction || null,
    p_inspection_notes: inspectionNotes || null,
    p_action_type: actionType || 'other',
    p_priority: priority || 'medium',
    p_inspector_name: inspectorName.trim()
  })

  if (error) throw new Error('Submission failed: ' + error.message)

  return { success: true }
}

/* ---------------------------------------------------------------------------
 * SCREEN FLOW SKETCH (pseudo-code, not runnable)
 * ---------------------------------------------------------------------------
 *
 * App launch
 *   └─ getStoredInspectorName()
 *        ├─ null  → NameSetupScreen: "What's your name?" → saveInspectorName()
 *        └─ found → straight to ScannerScreen (no login, no splash gate)
 *
 * ScannerScreen
 *   └─ expo-camera / expo-barcode-scanner
 *        └─ onBarCodeScanned(data)
 *             └─ findEquipmentByQrCode(data)
 *                  ├─ error → show "Unknown code, try again", stay on scanner
 *                  └─ ok    → navigate to InspectionForm(equipment)
 *
 * InspectionForm(equipment)
 *   ├─ Header: equipment_code, type, building, location  (read-only)
 *   ├─ Condition:  [ Functional ] [ Defective ]   ← big tap targets, gloves
 *   │
 *   ├─ if Functional:
 *   │     └─ Notes (optional) → Submit
 *   │
 *   └─ if Defective:
 *         ├─ Findings          (required — what's wrong)
 *         ├─ Recommended action (required — what should happen)
 *         ├─ Action type       (default from DEFAULT_ACTION_BY_TYPE)
 *         ├─ Priority          (default 'medium')
 *         └─ Notes (optional)
 *
 *   Submit
 *     └─ submitInspection({ ...form, inspectorName })
 *          ├─ error → keep the form filled, show the message, allow retry
 *          └─ ok    → confirmation screen:
 *                      "Inspection recorded. GSO has been notified."
 *                      → back to scanner for the next unit
 *
 * NOTE ON OFFLINE USE
 * Signal is unreliable inside concrete buildings. Consider queueing failed
 * submissions in AsyncStorage and retrying when connectivity returns — the
 * inspector shouldn't have to walk back to a room to re-enter a finding.
 * This is a genuine, defensible "future enhancement" if the panel asks.
 * --------------------------------------------------------------------------- */