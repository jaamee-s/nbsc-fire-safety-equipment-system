/* =====================================================================
   officialForms.js — data for the NBSC official forms (migration 020)

   Job Order Request (FM-NBSC-GSO-004) and Purchase Request
   (FM-NBSC-PMO-003): creating them pre-filled from the dashboard's
   records, loading them, and the print page address.
   ===================================================================== */
import { supabase } from './supabaseClient'

export const GSO_OFFICE = 'General Services Office'

// The print pages: /forms/jor/<id>/print and /forms/pr/<id>/print
export const formPrintUrl = (kind, id) => `/forms/${kind}/${id}/print`

export function parseFormPrintRoute(pathname) {
  const m = /^\/forms\/(jor|pr)\/([0-9a-f-]{36})\/print\/?$/i.exec(pathname || '')
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null
}

// Before migration 020 the tables don't exist: say what to do instead of
// showing the raw database error.
export function formsErrorMessage(error) {
  const msg = error?.message || String(error)
  if (/job_order_requests|purchase_request|schema cache|does not exist/i.test(msg)) {
    return 'The official forms are not set up in the database yet. Run migration 020_official_forms.sql in the Supabase SQL Editor.'
  }
  return msg
}

// The newest form for each linked record: { [source_record_id]: row }
export function latestBySource(rows = []) {
  const map = {}
  rows.forEach((r) => {
    if (!r.source_record_id) return
    const prev = map[r.source_record_id]
    if (!prev || r.created_at > prev.created_at) map[r.source_record_id] = r
  })
  return map
}

// Short list for the dashboard buttons (the full rows load in the editor
// and on the print page). Returns [] before migration 020.
export async function fetchFormSummaries() {
  const [jor, pr] = await Promise.all([
    supabase
      .from('job_order_requests')
      .select('id, source_record_id, inspection_assignment_id, jor_no, status, created_at'),
    supabase.from('purchase_requests').select('id, source_record_id, pr_no, status, created_at')
  ])
  return { jobOrders: jor.error ? [] : jor.data || [], purchases: pr.error ? [] : pr.data || [] }
}

/* ------------------------------------------------------------------ */
/* Job Order Request drafts                                            */
/* ------------------------------------------------------------------ */
// A draft holds the official form's fields the GSO fills in when filing a
// Job Order (strings, '' for blank). The rest of the form (approval,
// completion) is filled in later with "Edit Job Order Request".

function baseDraft(profile) {
  return {
    jor_no: '',
    name: profile?.full_name || '',
    position: '',
    department_unit: GSO_OFFICE,
    immediate_supervisor: '',
    contact_no: '',
    request_type: 'repair',
    request_type_other: '',
    location_from: '',
    office_room_to: '',
    nature_of_work: '',
    description: '',
    remarks: ''
  }
}

// Repair: a defect (Priority Action) going to a technician.
export function jobOrderDraftFromAction(action, profile, typeLabel) {
  const eq = action.equipment || {}
  return {
    ...baseDraft(profile),
    request_type: 'repair',
    office_room_to: [eq.buildings?.building_name, eq.exact_location].filter(Boolean).join(' — '),
    description: `${eq.equipment_code || 'Equipment'} (${typeLabel(eq.equipment_type)}): ${
      action.description || 'Reported defect'
    }`,
    remarks: action.job_order_remarks || ''
  }
}

// Inspection: a building (or one floor) going to an inspector.
export function jobOrderDraftForInspection({ buildingName, floorLabel, coveredCount, notes, profile }) {
  return {
    ...baseDraft(profile),
    request_type: 'inspection',
    office_room_to: `${buildingName || 'Building'}${floorLabel ? ` — ${floorLabel}` : ' (whole building)'}`,
    description: inspectionDescription(coveredCount),
    remarks: notes || ''
  }
}

export const inspectionDescription = (coveredCount) =>
  `Inspect the fire safety equipment in service (${coveredCount} unit${coveredCount === 1 ? '' : 's'}).`

// What's wrong with a draft before it is saved, or null.
export function checkJobOrderDraft(draft) {
  if (!draft.name.trim()) return 'Name (requester) is required on the Job Order Request.'
  if (!draft.description.trim()) return 'Description / details of the Job Order Request is required.'
  if (draft.request_type === 'others' && !draft.request_type_other.trim())
    return 'Type what the "Others" request is.'
  return null
}

// The JOR No. must be unique. Checked before the Job Order is filed, so a
// taken number doesn't leave a Job Order without its form.
export async function isJorNoTaken(jorNo, exceptId = null) {
  const no = (jorNo || '').trim()
  if (!no) return false
  let query = supabase.from('job_order_requests').select('id').eq('jor_no', no)
  if (exceptId) query = query.neq('id', exceptId)
  const { data, error } = await query.limit(1)
  return !error && (data || []).length > 0
}

// Saves a draft as a Job Order Request. `link` is { source_record_id } for a
// repair or { inspection_assignment_id } for an inspection; facilitatedBy is
// the technician or inspector who does the work.
export async function insertJobOrderForm(draft, link, facilitatedBy) {
  const row = { ...link, facilitated_by: facilitatedBy || null }
  Object.entries(draft).forEach(([k, v]) => {
    row[k] = typeof v === 'string' ? v.trim() || null : v
  })
  const { data, error } = await supabase.from('job_order_requests').insert(row).select('id').single()
  if (error) throw error
  return data.id
}

// A Job Order filed before the forms existed: its form, from the defect.
export function createJobOrderForm({ action, technicianName, profile, typeLabel }) {
  return insertJobOrderForm(
    jobOrderDraftFromAction(action, profile, typeLabel),
    { source_record_id: action.id },
    technicianName
  )
}

// A Purchase Request for one unit that needs a replacement and has no
// stock to cover it. `item` is a row of findPurchaseRequestItems()
// (gsoNotifications.js). The unit cost starts at 0 for the GSO to fill in.
export async function createPurchaseRequestForm({ item, profile, typeLabel }) {
  const where = [item.building, item.location].filter(Boolean).join(' — ')
  const { data: pr, error } = await supabase
    .from('purchase_requests')
    .insert({
      source_record_id: item.equipmentId,
      office_section: GSO_OFFICE,
      purpose: `Replacement for ${item.code} (${typeLabel(item.type)})${where ? ` at ${where}` : ''}${
        item.reason ? `: ${item.reason}` : ''
      }`,
      requested_by_name: profile.full_name
    })
    .select('id')
    .single()
  if (error) throw error

  const { error: itemError } = await supabase.from('purchase_request_items').insert({
    purchase_request_id: pr.id,
    line_no: 1,
    unit: 'unit',
    item_description: `${typeLabel(item.type)} (replacement for ${item.code})`,
    quantity: 1,
    unit_cost: 0
  })
  if (itemError) throw itemError
  return pr.id
}
