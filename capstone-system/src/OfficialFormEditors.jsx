/* =====================================================================
   OfficialFormEditors.jsx — edit windows for the NBSC official forms

     JorEditorModal  Job Order Request (FM-NBSC-GSO-004)
     PrEditorModal   Purchase Request (FM-NBSC-PMO-003) with its items

   Both load the form by id, save it, and offer "View / Print form",
   which opens the official A4 layout in a new tab.
   ===================================================================== */
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { JOR_REQUEST_TYPES, JOR_NATURE_OF_WORK } from './components/forms/formOptions'
import { formPrintUrl, formsErrorMessage } from './officialForms'

// The printed Purchase Request has 7 item rows; more would run past one A4 sheet.
const MAX_PR_ITEMS = 7

const boxStyle = { maxWidth: '760px', maxHeight: '90vh', overflowY: 'auto', textAlign: 'left' }
const sectionStyle = { fontWeight: 700, fontSize: '0.92rem', margin: '18px 0 10px 0' }
const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }
const hintStyle = { fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 14px 0' }

// Text inputs keep '' while editing; the database gets null for blanks.
const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v)
const asText = (v) => (v === null || v === undefined ? '' : String(v))

// timestamptz <-> <input type="datetime-local"> (local time, no seconds)
function toLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)

// Today's local calendar date. toISOString() is UTC, which in the
// Philippines gives yesterday's date before 8 AM.
function todayYmd() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function Field({ label, children, wide }) {
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <label className="field-label">{label}</label>
      {children}
    </div>
  )
}

function EditorShell({ title, subtitle, loading, loadError, error, saving, onClose, onSave, printHref, children }) {
  return (
    <div className="modal-overlay">
      <div className="modal-box" style={boxStyle}>
        <div className="modal-title">{title}</div>
        <p style={hintStyle}>{subtitle}</p>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        ) : loadError ? (
          <p className="form-error">{loadError}</p>
        ) : (
          children
        )}
        {error && <p className="form-error" style={{ marginTop: '12px' }}>{error}</p>}
        <div className="modal-actions" style={{ gap: '8px', marginTop: '18px', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Close
          </button>
          {printHref && !loadError && (
            <a
              className="btn btn-secondary"
              href={printHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              View / Print form
            </a>
          )}
          {!loadError && (
            <button className="btn btn-primary" onClick={onSave} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Job Order Request                                                   */
/* ------------------------------------------------------------------ */

const JOR_TEXT_FIELDS = [
  'jor_no', 'name', 'position', 'department_unit', 'date_of_filing', 'immediate_supervisor', 'contact_no',
  'request_type', 'request_type_other', 'location_from', 'office_room_to', 'nature_of_work', 'description',
  'acknowledged_by', 'remarks', 'action_taken', 'action_reason', 'gso_head_name', 'facilitated_by',
  'completion_confirmed_by', 'completion_remarks'
]

export function JorEditorModal({ id, onClose, onSaved }) {
  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase
      .from('job_order_requests')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error: e }) => {
        if (e) return setLoadError(formsErrorMessage(e))
        const f = {}
        JOR_TEXT_FIELDS.forEach((k) => (f[k] = asText(data[k])))
        f.completed_at = toLocalInput(data.completed_at)
        setForm(f)
      })
  }, [id])

  const set = (k) => (e) => setForm((prev) => ({ ...prev, [k]: e.target.value }))

  async function save() {
    setError(null)
    if (!form.name.trim()) return setError('Name is required.')
    if (!form.description.trim()) return setError('Description / details of the job order is required.')
    if (form.request_type === 'others' && !form.request_type_other.trim())
      return setError('Type what the "Others" request is.')
    if (form.action_taken === 'disapproved' && !form.action_reason.trim())
      return setError('Give the reason it was disapproved.')

    const changes = {}
    JOR_TEXT_FIELDS.forEach((k) => (changes[k] = blankToNull(form[k])))
    changes.date_of_filing = changes.date_of_filing || todayYmd()
    changes.completed_at = fromLocalInput(form.completed_at)
    // Status follows the form: completed once the end user confirms,
    // otherwise the GSO head's action, otherwise still pending.
    changes.status = changes.completed_at ? 'completed' : changes.action_taken || 'pending'

    setSaving(true)
    const { error: e } = await supabase.from('job_order_requests').update(changes).eq('id', id)
    setSaving(false)
    if (e) {
      setError(/jor_no/.test(e.message) && /unique|duplicate/i.test(e.message)
        ? `JOR No. "${changes.jor_no}" is already used by another Job Order Request.`
        : formsErrorMessage(e))
      return
    }
    onSaved?.('Job Order Request saved.')
  }

  return (
    <EditorShell
      title="Job Order Request (FM-NBSC-GSO-004)"
      subtitle="Fill in what the printed form needs. Signatures stay blank lines, to be signed by hand."
      loading={!form && !loadError}
      loadError={loadError}
      error={error}
      saving={saving}
      onClose={onClose}
      onSave={save}
      printHref={formPrintUrl('jor', id)}
    >
      {form && (
        <>
          <div style={sectionStyle}>Request</div>
          <div style={grid2}>
            <Field label="JOR No.">
              <input value={form.jor_no} onChange={set('jor_no')} placeholder="Assigned by the GSO" />
            </Field>
            <Field label="Date of filing">
              <input type="date" value={form.date_of_filing} onChange={set('date_of_filing')} />
            </Field>
            <Field label="Name (requester)">
              <input value={form.name} onChange={set('name')} />
            </Field>
            <Field label="Position">
              <input value={form.position} onChange={set('position')} />
            </Field>
            <Field label="Department / Unit">
              <input value={form.department_unit} onChange={set('department_unit')} />
            </Field>
            <Field label="Immediate supervisor">
              <input value={form.immediate_supervisor} onChange={set('immediate_supervisor')} />
            </Field>
            <Field label="Contact no.">
              <input value={form.contact_no} onChange={set('contact_no')} />
            </Field>
          </div>

          <div style={sectionStyle}>Type of job order request</div>
          <div style={grid2}>
            <Field label="Type">
              <select value={form.request_type} onChange={set('request_type')}>
                {JOR_REQUEST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            {form.request_type === 'others' && (
              <Field label="Others (specify)">
                <input value={form.request_type_other} onChange={set('request_type_other')} />
              </Field>
            )}
            <Field label="Nature of work">
              <select value={form.nature_of_work} onChange={set('nature_of_work')}>
                <option value="">Not set</option>
                {JOR_NATURE_OF_WORK.map((n) => (
                  <option key={n.value} value={n.value}>{n.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Location (from)">
              <input value={form.location_from} onChange={set('location_from')} />
            </Field>
            <Field label="Office / Room no. (to)">
              <input value={form.office_room_to} onChange={set('office_room_to')} />
            </Field>
            <Field label="Description / details of job order requested" wide>
              <textarea rows={3} value={form.description} onChange={set('description')} />
            </Field>
          </div>

          <div style={sectionStyle}>GSO processing</div>
          <div style={grid2}>
            <Field label="Acknowledged by (GSO staff)">
              <input value={form.acknowledged_by} onChange={set('acknowledged_by')} />
            </Field>
            <Field label="Remarks">
              <input value={form.remarks} onChange={set('remarks')} />
            </Field>
            <Field label="Action taken">
              <select value={form.action_taken} onChange={set('action_taken')}>
                <option value="">Not yet decided</option>
                <option value="approved">Approved</option>
                <option value="disapproved">Disapproved</option>
              </select>
            </Field>
            <Field label={form.action_taken === 'disapproved' ? 'Reason (required)' : 'Reason'}>
              <input value={form.action_reason} onChange={set('action_reason')} />
            </Field>
            <Field label="Head, General Services Office">
              <input value={form.gso_head_name} onChange={set('gso_head_name')} />
            </Field>
            <Field label="Facilitated by">
              <input value={form.facilitated_by} onChange={set('facilitated_by')} />
            </Field>
          </div>

          <div style={sectionStyle}>Work completion confirmation by end user</div>
          <div style={grid2}>
            <Field label="Name">
              <input value={form.completion_confirmed_by} onChange={set('completion_confirmed_by')} />
            </Field>
            <Field label="Date / time completed">
              <input type="datetime-local" value={form.completed_at} onChange={set('completed_at')} />
            </Field>
            <Field label="Remarks" wide>
              <textarea rows={2} value={form.completion_remarks} onChange={set('completion_remarks')} />
            </Field>
          </div>
        </>
      )}
    </EditorShell>
  )
}

/* ------------------------------------------------------------------ */
/* Purchase Request                                                    */
/* ------------------------------------------------------------------ */

const PR_TEXT_FIELDS = [
  'pr_no', 'entity_name', 'fund_cluster', 'office_section', 'responsibility_center_code', 'pr_date', 'purpose',
  'requested_by_name', 'requested_by_designation', 'requested_date', 'approved_by_name', 'approved_date', 'status'
]
const emptyItem = () => ({ stock_property_no: '', unit: 'unit', item_description: '', quantity: '1', unit_cost: '0' })
const peso = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function PrEditorModal({ id, onClose, onSaved }) {
  const [form, setForm] = useState(null)
  const [items, setItems] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('purchase_requests').select('*').eq('id', id).single(),
      supabase.from('purchase_request_items').select('*').eq('purchase_request_id', id).order('line_no')
    ]).then(([pr, its]) => {
      if (pr.error || its.error) return setLoadError(formsErrorMessage(pr.error || its.error))
      const f = {}
      PR_TEXT_FIELDS.forEach((k) => (f[k] = asText(pr.data[k])))
      setForm(f)
      setItems(
        (its.data || []).map((it) => ({
          stock_property_no: asText(it.stock_property_no),
          unit: asText(it.unit),
          item_description: asText(it.item_description),
          quantity: asText(it.quantity),
          unit_cost: asText(it.unit_cost)
        }))
      )
    })
  }, [id])

  const set = (k) => (e) => setForm((prev) => ({ ...prev, [k]: e.target.value }))
  const setItem = (i, k) => (e) =>
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, [k]: e.target.value } : it)))

  const lineTotal = (it) => {
    const q = Number(it.quantity)
    const c = Number(it.unit_cost)
    return Number.isFinite(q) && Number.isFinite(c) ? q * c : 0
  }
  const grandTotal = items.reduce((sum, it) => sum + lineTotal(it), 0)

  async function save() {
    setError(null)
    if (!form.entity_name.trim()) return setError('Entity name is required.')
    for (const [i, it] of items.entries()) {
      const n = i + 1
      if (!it.unit.trim()) return setError(`Item ${n}: unit is required (for example: unit, pc, set).`)
      if (!it.item_description.trim()) return setError(`Item ${n}: item description is required.`)
      if (!(Number(it.quantity) > 0)) return setError(`Item ${n}: quantity must be more than 0.`)
      if (it.unit_cost.trim() === '' || !(Number(it.unit_cost) >= 0))
        return setError(`Item ${n}: unit cost must be 0 or more.`)
    }

    const changes = {}
    PR_TEXT_FIELDS.forEach((k) => (changes[k] = blankToNull(form[k])))
    changes.pr_date = changes.pr_date || todayYmd()
    changes.status = changes.status || 'pending'

    setSaving(true)
    const { error: e } = await supabase.from('purchase_requests').update(changes).eq('id', id)
    if (e) {
      setSaving(false)
      setError(/pr_no/.test(e.message) && /unique|duplicate/i.test(e.message)
        ? `PR No. "${changes.pr_no}" is already used by another Purchase Request.`
        : formsErrorMessage(e))
      return
    }

    // Item lines are saved as a whole: the old lines are replaced, numbered 1, 2, 3...
    const { error: delError } = await supabase.from('purchase_request_items').delete().eq('purchase_request_id', id)
    if (!delError && items.length > 0) {
      const { error: insError } = await supabase.from('purchase_request_items').insert(
        items.map((it, i) => ({
          purchase_request_id: id,
          line_no: i + 1,
          stock_property_no: blankToNull(it.stock_property_no),
          unit: it.unit.trim(),
          item_description: it.item_description.trim(),
          quantity: Number(it.quantity),
          unit_cost: Number(it.unit_cost)
        }))
      )
      if (insError) {
        setSaving(false)
        setError('The items could not be saved: ' + formsErrorMessage(insError) + ' Click Save changes again.')
        return
      }
    }
    setSaving(false)
    if (delError) {
      setError('The items could not be saved: ' + formsErrorMessage(delError))
      return
    }
    onSaved?.('Purchase Request saved.')
  }

  return (
    <EditorShell
      title="Purchase Request (FM-NBSC-PMO-003)"
      subtitle="Fill in what the printed form needs. Signatures stay blank lines, to be signed by hand."
      loading={!form && !loadError}
      loadError={loadError}
      error={error}
      saving={saving}
      onClose={onClose}
      onSave={save}
      printHref={formPrintUrl('pr', id)}
    >
      {form && (
        <>
          <div style={sectionStyle}>Request</div>
          <div style={grid2}>
            <Field label="PR No.">
              <input value={form.pr_no} onChange={set('pr_no')} placeholder="Assigned by Supply / PMO" />
            </Field>
            <Field label="Date">
              <input type="date" value={form.pr_date} onChange={set('pr_date')} />
            </Field>
            <Field label="Entity name">
              <input value={form.entity_name} onChange={set('entity_name')} />
            </Field>
            <Field label="Fund cluster">
              <input value={form.fund_cluster} onChange={set('fund_cluster')} />
            </Field>
            <Field label="Office / Section">
              <input value={form.office_section} onChange={set('office_section')} />
            </Field>
            <Field label="Responsibility center code">
              <input value={form.responsibility_center_code} onChange={set('responsibility_center_code')} />
            </Field>
            <Field label="Purpose" wide>
              <textarea rows={2} value={form.purpose} onChange={set('purpose')} />
            </Field>
          </div>

          <div style={sectionStyle}>
            Items ({items.length} of {MAX_PR_ITEMS}) · Total PhP {peso.format(grandTotal)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {items.map((it, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '0.88rem' }}>Item {i + 1}</strong>
                  <button
                    className="btn btn-outline-red btn-sm"
                    onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
                <div style={grid2}>
                  <Field label="Item description" wide>
                    <input value={it.item_description} onChange={setItem(i, 'item_description')} />
                  </Field>
                  <Field label="Stock / Property no.">
                    <input value={it.stock_property_no} onChange={setItem(i, 'stock_property_no')} />
                  </Field>
                  <Field label="Unit">
                    <input value={it.unit} onChange={setItem(i, 'unit')} />
                  </Field>
                  <Field label="Quantity">
                    <input type="number" min="0" step="any" value={it.quantity} onChange={setItem(i, 'quantity')} />
                  </Field>
                  <Field label={`Unit cost (PhP) · line total ${peso.format(lineTotal(it))}`}>
                    <input type="number" min="0" step="0.01" value={it.unit_cost} onChange={setItem(i, 'unit_cost')} />
                  </Field>
                </div>
              </div>
            ))}
            {items.length < MAX_PR_ITEMS ? (
              <button
                className="btn btn-secondary btn-sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setItems((prev) => [...prev, emptyItem()])}
              >
                + Add item
              </button>
            ) : (
              <p style={hintStyle}>The printed form has room for {MAX_PR_ITEMS} items.</p>
            )}
          </div>

          <div style={sectionStyle}>Signatories</div>
          <div style={grid2}>
            <Field label="Requested by (printed name)">
              <input value={form.requested_by_name} onChange={set('requested_by_name')} />
            </Field>
            <Field label="Designation">
              <input value={form.requested_by_designation} onChange={set('requested_by_designation')} />
            </Field>
            <Field label="Date requested">
              <input type="date" value={form.requested_date} onChange={set('requested_date')} />
            </Field>
            <Field label="Approved by (SUC President I)">
              <input value={form.approved_by_name} onChange={set('approved_by_name')} />
            </Field>
            <Field label="Date approved">
              <input type="date" value={form.approved_date} onChange={set('approved_date')} />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={set('status')}>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
          </div>
        </>
      )}
    </EditorShell>
  )
}
