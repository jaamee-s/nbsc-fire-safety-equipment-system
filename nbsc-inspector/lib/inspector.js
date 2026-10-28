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
  functional: 'Functional',
  defective: 'Defective',
  for_repair: 'For Repair',
  for_replacement: 'For Replacement',
  expired: 'Expired',
  no_longer_in_service: 'No Longer in Service'
}

export const ROLE_LABELS = {
  inspector: 'Inspector',
  technician: 'Technician'
}

export const REPAIR_STATUS_LABELS = {
  assigned: 'Assigned',
  working: 'Working on it',
  repaired: 'Marked repaired'
}

// Equipment with one of these statuses has a reported defect that GSO has not
// resolved yet. It cannot be inspected again until GSO records the outcome and
// the unit is back to Functional. The database enforces the same rule.
export const OPEN_PROBLEM_STATUSES = ['defective', 'for_repair', 'for_replacement']

// Preset findings per equipment type, derived from the inspection flowcharts.
// Each one carries what it implies, so choosing a finding also sets a sensible
// action type and priority — the inspector can still override both.
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
// Errors. Signal inside concrete buildings is unreliable, and the raw messages
// ("TypeError: Network request failed") mean nothing to someone standing in a
// stairwell. Turn them into something actionable.
// ---------------------------------------------------------------------------

const NO_CONNECTION = 'No connection. Check your signal and try again.'

function isNetworkMessage(message) {
  return /network request failed|failed to fetch|network error|timed out/i.test(message || '')
}

function toError(prefix, err) {
  const message = err?.message || String(err)
  return new Error(isNetworkMessage(message) ? NO_CONNECTION : `${prefix}${message}`)
}

// ---------------------------------------------------------------------------
// Accounts. Inspectors and technicians sign in with an account created by the
// GSO administrator. The role comes from the `profiles` table, the same table
// the web app uses.
//
// Needs lib/supabase.js to create the client with session storage, so the
// login survives closing the app (see the setup notes).
// ---------------------------------------------------------------------------

const MOBILE_ROLES = ['inspector', 'technician']

async function loadAccount(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw toError('Could not load your account: ', error)
  if (!data) throw new Error('Your account is not set up yet. Please contact the GSO.')
  if (!MOBILE_ROLES.includes(data.role)) {
    await supabase.auth.signOut()
    throw new Error('This account is for the GSO web dashboard. Inspectors and technicians use the mobile app.')
  }
  return data
}

export async function signIn(email, password) {
  const cleanEmail = (email || '').trim()
  if (!cleanEmail || !password) throw new Error('Enter your email and password.')

  let result
  try {
    result = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
  } catch (err) {
    throw toError('Sign-in failed: ', err)
  }

  if (result.error) {
    if (/invalid login credentials/i.test(result.error.message)) {
      throw new Error('Wrong email or password.')
    }
    throw toError('Sign-in failed: ', result.error)
  }
  return loadAccount(result.data.user.id)
}

// Returns the signed-in account, or null when nobody is signed in.
export async function restoreSession() {
  let result
  try {
    result = await supabase.auth.getSession()
  } catch (err) {
    return null
  }
  const user = result?.data?.session?.user
  if (!user) return null
  try {
    return await loadAccount(user.id)
  } catch (err) {
    return null
  }
}

export async function signOut() {
  try {
    await supabase.auth.signOut()
  } catch (err) {
    console.error('Sign-out failed:', err)
  }
}

export function onSignedOut(callback) {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback()
  })
  return () => data.subscription.unsubscribe()
}

// ---------------------------------------------------------------------------
// QR lookup. The scanned value is just the equipment code — the record is
// fetched live, so a sticker stays correct after the unit moves or is refilled.
// Every unit has its own unique code, so one sticker is always one unit.
// ---------------------------------------------------------------------------

export async function findEquipmentByQrCode(scannedValue) {
  const code = (scannedValue || '').trim()
  if (!code) throw new Error('Empty code.')

  let result
  try {
    result = await supabase.rpc('lookup_equipment', { p_code: code })
  } catch (err) {
    throw toError('Lookup failed: ', err)
  }

  const { data, error } = result
  if (error) throw toError('Lookup failed: ', error)
  if (!data) throw new Error(`No equipment found for "${code}".`)

  return data
}

// ---------------------------------------------------------------------------
// Inspection submission — the single write path for inspectors.
//
// The database function handles all three steps atomically:
//   1. insert the inspection (server-side timestamp, signed-in inspector)
//   2. update equipment.current_status
//   3. if defective, create a pending maintenance_action for GSO
//
// The database also refuses inspections on retired equipment and on equipment
// with an unresolved defect, so those rules hold even if the screen is stale.
// ---------------------------------------------------------------------------

export async function submitInspection({
  equipmentId,
  conditionStatus,
  findings,
  inspectionNotes,
  actionType,
  priority
}) {
  if (!CONDITION_OPTIONS.includes(conditionStatus)) {
    throw new Error('Select a condition first.')
  }
  if (conditionStatus === 'defective' && !(findings || '').trim()) {
    throw new Error('Select what is wrong before submitting.')
  }

  let result
  try {
    result = await supabase.rpc('submit_inspector_inspection', {
      p_equipment_id: equipmentId,
      p_condition_status: conditionStatus,
      p_findings: (findings || '').trim() || null,
      p_recommended_action: null,
      p_inspection_notes: (inspectionNotes || '').trim() || null,
      p_action_type: actionType || 'other',
      p_priority: priority || 'medium'
    })
  } catch (err) {
    throw toError('Submission failed: ', err)
  }

  if (result.error) throw toError('Submission failed: ', result.error)
  return { success: true }
}

// ---------------------------------------------------------------------------
// Dashboards. Both are read through one narrow database function each, scoped
// to the signed-in account.
// ---------------------------------------------------------------------------

export async function getInspectorDashboard() {
  let result
  try {
    result = await supabase.rpc('get_inspector_dashboard')
  } catch (err) {
    throw toError('Could not load dashboard: ', err)
  }
  if (result.error) throw toError('Could not load dashboard: ', result.error)
  return result.data
}

export async function getTechnicianDashboard() {
  let result
  try {
    result = await supabase.rpc('get_technician_dashboard')
  } catch (err) {
    throw toError('Could not load your jobs: ', err)
  }
  if (result.error) throw toError('Could not load your jobs: ', result.error)
  return result.data
}

// Technician updates the repair status of an assigned job.
// status: 'working' | 'repaired'. GSO verifies and records the final outcome.
export async function updateRepairStatus(actionId, status, note) {
  let result
  try {
    result = await supabase.rpc('update_repair_status', {
      p_action_id: actionId,
      p_repair_status: status,
      p_note: (note || '').trim() || null
    })
  } catch (err) {
    throw toError('Update failed: ', err)
  }
  if (result.error) throw toError('Update failed: ', result.error)
  return { success: true }
}

// "3 days ago", "just now" — for dashboard lists.
export function relativeTime(dateString) {
  if (!dateString) return 'Never inspected'
  const mins = Math.floor((new Date() - new Date(dateString)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

// Days until expiry — negative means already expired.
//
// A bare 'YYYY-MM-DD' string is parsed by JavaScript as UTC midnight, which
// in timezones behind UTC lands on the previous local day and makes every
// expiry read one day early. Building the date from its parts keeps it on
// the calendar day it was entered as, in any timezone.
export function daysUntil(dateString) {
  if (!dateString) return null

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString)
  const target = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(dateString)
  target.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}
