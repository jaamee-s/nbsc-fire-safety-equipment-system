/* =====================================================================
   JobOrderWindow.jsx — filing a Job Order on the official form

   One window for both kinds of Job Order:
     left   who does the work (technician or inspector, passed in as
            `assignment`) and the Job Order Request fields the GSO fills in
     right  the official FM-NBSC-GSO-004 form, updating as they type,
            exactly as it prints
   The person picker is not part of the official form: the chosen person
   fills its "Facilitated by" line.
   ===================================================================== */
import JobOrderRequestForm from './components/forms/JobOrderRequestForm'
import { JOR_REQUEST_TYPES, JOR_NATURE_OF_WORK } from './components/forms/formOptions'

// Preview size: the A4 form (210 × 297 mm) shown at 62%.
const PREVIEW_SCALE = 0.62

function todayYmd() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function Field({ label, children }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
    </div>
  )
}

export default function JobOrderWindow({
  title,
  assignmentTitle,
  assignment,
  draft,
  onDraftChange,
  facilitatedBy,
  error,
  saving,
  submitDisabled,
  onCancel,
  onSubmit
}) {
  const set = (k) => (e) => onDraftChange({ ...draft, [k]: e.target.value })
  const preview = { ...draft, date_of_filing: todayYmd(), facilitated_by: facilitatedBy || '' }

  return (
    <div className="modal-overlay">
      <div className="modal-box jo-window" style={{ textAlign: 'left' }}>
        <div className="modal-title">{title}</div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 14px 0' }}>
          Filled in on the official Job Order Request form (FM-NBSC-GSO-004). After submitting, print it
          from <b>View / Print form</b>. Approval and completion are filled in later with <b>Edit Job Order Request</b>.
        </p>

        <div className="jo-window-grid">
          {/* Left: what the GSO fills in */}
          <div className="jo-window-fields">
            <div className="jo-window-section">{assignmentTitle}</div>
            {assignment}

            <div className="jo-window-section">Job Order Request</div>
            <Field label="JOR No.">
              <input value={draft.jor_no} onChange={set('jor_no')} placeholder="Assigned by the GSO (optional now)" />
            </Field>
            <Field label="Type of job order request">
              <select value={draft.request_type} onChange={set('request_type')}>
                {JOR_REQUEST_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            {draft.request_type === 'others' && (
              <Field label="Others (specify)">
                <input value={draft.request_type_other} onChange={set('request_type_other')} />
              </Field>
            )}
            <Field label="Nature of work">
              <select value={draft.nature_of_work} onChange={set('nature_of_work')}>
                <option value="">Not set</option>
                {JOR_NATURE_OF_WORK.map((n) => (
                  <option key={n.value} value={n.value}>{n.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Location (from)">
              <input value={draft.location_from} onChange={set('location_from')} />
            </Field>
            <Field label="Office / Room no. (to)">
              <input value={draft.office_room_to} onChange={set('office_room_to')} />
            </Field>
            <Field label="Description / details of job order requested">
              <textarea rows={3} value={draft.description} onChange={set('description')} />
            </Field>
            <Field label="Remarks / special instructions (optional)">
              <textarea rows={2} value={draft.remarks} onChange={set('remarks')} />
            </Field>

            <div className="jo-window-section">Requester</div>
            <Field label="Name">
              <input value={draft.name} onChange={set('name')} />
            </Field>
            <Field label="Position">
              <input value={draft.position} onChange={set('position')} />
            </Field>
            <Field label="Department / Unit">
              <input value={draft.department_unit} onChange={set('department_unit')} />
            </Field>
            <Field label="Immediate supervisor">
              <input value={draft.immediate_supervisor} onChange={set('immediate_supervisor')} />
            </Field>
            <Field label="Contact no.">
              <input value={draft.contact_no} onChange={set('contact_no')} />
            </Field>
          </div>

          {/* Right: the official form, as it prints */}
          <div className="jo-window-preview" aria-label="Preview of the printed Job Order Request">
            <div
              className="jo-window-preview-frame"
              style={{ width: `calc(210mm * ${PREVIEW_SCALE})`, height: `calc(297mm * ${PREVIEW_SCALE})` }}
            >
              <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
                <JobOrderRequestForm data={preview} />
              </div>
            </div>
          </div>
        </div>

        {error && <p className="form-error" style={{ marginTop: '12px' }}>{error}</p>}

        <div className="modal-actions" style={{ gap: '8px', marginTop: '14px' }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={saving || submitDisabled}>
            {saving ? 'Submitting...' : 'Submit Job Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
