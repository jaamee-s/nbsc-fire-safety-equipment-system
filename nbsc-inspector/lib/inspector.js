import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

// These MUST match the database check constraints exactly — lowercase with
// underscores. A mismatch is rejected by Postgres, not caught by the UI.
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

export const TYPE_LABELS = {
  fire_extinguisher: 'Fire Extinguisher',
  fire_alarm: 'Fire Alarm',
  sprinkler: 'Sprinkler',
  emergency_light: 'Emergency Light',
  smoke_detector: 'Smoke Detector'
}

export const ACTION_TYPE_LABELS = {
  repair: 'Repair',
  replace: 'Replace',
  battery_replacement: 'Battery Replacement',
  refill: 'Refill',
  inspection: 'Inspection',
  other: 'Other'
}

export const STATUS_LABELS = {
  active: 'Active',
  defective: 'Defective',
  for_repair: 'For Repair',
  for_replacement: 'For Replacement',
  expired: 'Expired',
  inactive: 'Inactive'
}

// Preset findings per equipment type, derived from the inspection flowcharts.
// Each one carries what it implies, so choosing a finding also sets a sensible
// action type and priority — the inspector can still override both.
//
// This replaces the old free-text "recommended action" field. That field
// duplicated action_type in prose, and the two could contradict each other.
export const FINDINGS_BY_TYPE = {
  fire_extinguisher: [
    { label: 'Gauge in red zone (low pressure)', action: 'refill', priority: 'high' },
    { label: 'Gauge in overcharge zone', action: 'refill', priority: 'medium' },
    { label: 'Safety seal or pin missing', action: 'repair', priority: 'high' },
    { label: 'Hose or nozzle damaged', action: 'repair', priority: 'high' },
    { label: 'Body corroded or dented', action: 'replace', priority: 'high' },
    { label: 'Past expiration date', action: 'replace', priority: 'high' },
    { label: 'Missing from location', action: 'replace', priority: 'critical' },
    { label: 'Obstructed or hard to reach', action: 'other', priority: 'medium' }
  ],
  smoke_detector: [
    { label: 'No response to test button', action: 'repair', priority: 'high' },
    { label: 'Battery dead or low', action: 'battery_replacement', priority: 'high' },
    { label: 'Fault light blinking', action: 'repair', priority: 'medium' },
    { label: 'Unit loose or dislodged', action: 'repair', priority: 'medium' },
    { label: 'Physically damaged', action: 'replace', priority: 'high' },
    { label: 'Missing from location', action: 'replace', priority: 'critical' }
  ],
  emergency_light: [
    { label: 'Does not light on test', action: 'repair', priority: 'high' },
    { label: 'Battery not holding charge', action: 'battery_replacement', priority: 'high' },
    { label: 'Bulb or LED busted', action: 'replace', priority: 'medium' },
    { label: 'Dim or flickering', action: 'repair', priority: 'medium' },
    { label: 'Physically damaged', action: 'replace', priority: 'high' },
    { label: 'Missing from location', action: 'replace', priority: 'critical' }
  ],
  fire_alarm: [
    { label: 'No sound on test', action: 'repair', priority: 'critical' },
    { label: 'Weak or intermittent sound', action: 'repair', priority: 'high' },
    { label: 'Pull station damaged', action: 'repair', priority: 'high' },
    { label: 'Panel or wiring fault', action: 'repair', priority: 'critical' },
    { label: 'Physically damaged', action: 'replace', priority: 'high' },
    { label: 'Missing from location', action: 'replace', priority: 'critical' }
  ],
  sprinkler: [
    { label: 'Head corroded', action: 'replace', priority: 'high' },
    { label: 'Head obstructed or blocked', action: 'other', priority: 'high' },
    { label: 'Leaking', action: 'repair', priority: 'critical' },
    { label: 'Painted over', action: 'replace', priority: 'high' },
    { label: 'Physically damaged', action: 'replace', priority: 'high' },
    { label: 'Low water pressure', action: 'repair', priority: 'critical' }
  ]
}

export const OTHER_FINDING = '__other__'

// ---------------------------------------------------------------------------
// Inspector identity — asked once, stored on the device.
// Identity without authentication: no login, but every record is attributable.
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
  if (!trimmed) throw new Error('Please enter your name.')
  await AsyncStorage.setItem(INSPECTOR_NAME_KEY, trimmed)
  return trimmed
}

export async function clearInspectorName() {
  await AsyncStorage.removeItem(INSPECTOR_NAME_KEY)
}

// ---------------------------------------------------------------------------
// QR lookup. The scanned value is just the equipment code — the record is
// fetched live, so a sticker stays correct after the unit moves or is refilled.
// ---------------------------------------------------------------------------

export async function findEquipmentByQrCode(scannedValue) {
  const code = (scannedValue || '').trim()
  if (!code) throw new Error('Empty code.')

  const { data, error } = await supabase
    .from('equipment')
    .select(`
      id, equipment_code, equipment_type, exact_location,
      current_status, expiration_date, description,
      buildings ( building_name )
    `)
    .eq('qr_code', code)
    .maybeSingle()

  if (error) throw new Error('Lookup failed: ' + error.message)
  if (!data) throw new Error(`No equipment found for "${code}".`)

  return data
}

// ---------------------------------------------------------------------------
// Submission — the single write path.
//
// The database function handles all three steps atomically:
//   1. insert the inspection (server-side timestamp, inspector name)
//   2. update equipment.current_status
//   3. if defective, create a pending maintenance_action for GSO
// ---------------------------------------------------------------------------

export async function submitInspection({
  equipmentId,
  conditionStatus,
  findings,
  inspectionNotes,
  actionType,
  priority,
  inspectorName
}) {
  if (!CONDITION_OPTIONS.includes(conditionStatus)) {
    throw new Error('Select a condition first.')
  }
  if (!inspectorName || !inspectorName.trim()) {
    throw new Error('Inspector name is missing.')
  }
  if (conditionStatus === 'defective' && !(findings || '').trim()) {
    throw new Error('Select what is wrong before submitting.')
  }

  // p_recommended_action is passed as null on purpose. It duplicated
  // action_type in free text and the two could disagree. The database
  // falls back to findings for the maintenance action's description.
  const { error } = await supabase.rpc('submit_inspector_inspection', {
    p_equipment_id: equipmentId,
    p_condition_status: conditionStatus,
    p_findings: findings || null,
    p_recommended_action: null,
    p_inspection_notes: inspectionNotes || null,
    p_action_type: actionType || 'other',
    p_priority: priority || 'medium',
    p_inspector_name: inspectorName.trim()
  })

  if (error) throw new Error('Submission failed: ' + error.message)
  return { success: true }
}

// Days until expiry — negative means already expired.
export function daysUntil(dateString) {
  if (!dateString) return null
  const target = new Date(dateString)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}