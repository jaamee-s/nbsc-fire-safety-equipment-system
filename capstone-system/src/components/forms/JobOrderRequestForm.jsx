// FM-NBSC-GSO-004 — Job Order Request Form (Issue 01, Rev 01, effective 08.10.2026)
// Pass a row from the `job_order_requests` table as `data`. Any missing field prints as a blank line.
import { Check, Line, SignLine, NbscFormHeader, NbscFormFooter } from './NbscFormParts';
import { fmtDate, fmtDateTime } from './formFormat';
import { JOR_REQUEST_TYPES, JOR_NATURE_OF_WORK } from './formOptions';

export default function JobOrderRequestForm({ data = {} }) {
  const d = data;
  const othersLabel =
    d.request_type === 'others' && d.request_type_other ? `Others: ${d.request_type_other}` : 'Others';

  return (
    <div className="nbsc-form">
      <NbscFormHeader
        docCode="FM-NBSC-GSO-004"
        issueStatus="01"
        revNo="01"
        effectiveDate="08.10.2026"
      />

      <div className="nbsc-title">JOB ORDER REQUEST FORM</div>

      <div className="jor-no">
        JOR No: <Line value={d.jor_no} />
      </div>

      <div className="jor-info">
        <div className="jor-info__row">NAME: <Line value={d.name} /></div>
        <div className="jor-info__row">DATE OF FILING: <Line value={fmtDate(d.date_of_filing)} /></div>
        <div className="jor-info__row">POSITION&nbsp;&nbsp;: <Line value={d.position} /></div>
        <div className="jor-info__row">IMMEDIATE SUPERVISOR: <Line value={d.immediate_supervisor} /></div>
        <div className="jor-info__row">DEPARTMENT/UNIT: <Line value={d.department_unit} /></div>
        <div className="jor-info__row">CONTACT NO.: <Line value={d.contact_no} /></div>
      </div>

      <div className="jor-type-box">
        <div className="jor-type-box__title">TYPE OF JOB ORDER REQUEST</div>

        <div className="jor-type-grid">
          {/* same order as the paper form: row 1 then row 2 */}
          {JOR_REQUEST_TYPES.map((t) => (
            <Check
              key={t.value}
              checked={d.request_type === t.value}
              label={t.value === 'others' ? othersLabel : t.label}
            />
          ))}
        </div>

        <div className="jor-loc">
          <span>LOCATION (From)</span><span>:</span><Line value={d.location_from} />
          <span>OFFICE/ROOM NO. (To)</span><span>:</span><Line value={d.office_room_to} />
        </div>

        <div className="jor-nature__label">NATURE OF WORK:</div>
        <div className="jor-nature">
          {JOR_NATURE_OF_WORK.map((n) => (
            <Check key={n.value} checked={d.nature_of_work === n.value} label={n.label} />
          ))}
        </div>

        <div className="jor-desc">
          Description/Details of Job Order Requested:
          <div className="jor-desc__lines">
            <div className="jor-desc__text">{d.description || ''}</div>
          </div>
        </div>
      </div>

      <div className="jor-ack">
        <div>
          Acknowledge by:
          <div style={{ marginTop: '6mm' }}>
            <SignLine name={d.acknowledged_by} style={{ minWidth: '75mm' }} />
          </div>
          <div style={{ fontStyle: 'italic', marginTop: '1mm' }}>GSO Staff</div>
        </div>
        <div className="jor-ack__remarks">
          <span>Remarks:</span>
          <Line value={d.remarks} />
        </div>
      </div>

      <div className="jor-action">
        Action Taken:
        <div className="jor-action__row">
          <div className="jor-action__choice">
            <span><Line value={d.action_taken === 'approved' ? '✓' : ''} />Approved</span>
            <span><Line value={d.action_taken === 'disapproved' ? '✓' : ''} />Disapproved</span>
          </div>
          <div className="jor-action__reason">
            <span>Reason:</span>
            <Line value={d.action_reason} />
          </div>
        </div>
        <div style={{ marginTop: '8mm' }}>
          <SignLine name={d.gso_head_name} style={{ minWidth: '63mm' }} />
          <div style={{ marginTop: '1mm' }}>
            <i>Head</i>, General Services Office
          </div>
        </div>
      </div>

      <div className="jor-facilitated">
        Facilitated by: <Line value={d.facilitated_by} />
      </div>

      <div className="jor-complete-box">
        <div className="jor-complete__row">
          <span>Work completion confirmation by End User:</span>
          <Line value={d.completion_confirmed_by} />
          <Line value={fmtDateTime(d.completed_at)} />
        </div>
        <div className="jor-complete__captions">
          <span aria-hidden="true">Work completion confirmation by End User:</span>
          <span>Name/Signature</span>
          <span>Date/Time Completed</span>
        </div>
        <div style={{ marginTop: '3mm' }}>Remarks:</div>
        <div className="jor-desc__text" style={{ minHeight: '19.5mm', marginTop: '1mm' }}>
          {d.completion_remarks || ''}
        </div>
      </div>

      <NbscFormFooter />
    </div>
  );
}
