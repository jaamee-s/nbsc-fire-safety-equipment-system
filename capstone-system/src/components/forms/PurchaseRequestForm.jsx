// FM-NBSC-PMO-003 — Purchase Request (Issue 01, Rev 00, effective 07.25.2025)
// `data` = a row from `purchase_requests`; `items` = its rows from `purchase_request_items`.
import { Line, NbscFormHeader, NbscFormFooter } from './NbscFormParts';
import { fmtDate, fmtMoney } from './formFormat';

const MIN_ITEM_ROWS = 7; // the paper form has 7 item rows + the PhP total row

export default function PurchaseRequestForm({ data = {}, items = [] }) {
  const d = data;
  const sorted = [...items].sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0));
  const rows = [
    ...sorted,
    ...Array.from({ length: Math.max(0, MIN_ITEM_ROWS - sorted.length) }, () => null),
  ];

  const lineTotal = (it) => {
    if (!it) return null;
    if (it.total_amount != null) return Number(it.total_amount);
    const q = Number(it.quantity);
    const c = Number(it.unit_cost);
    return Number.isFinite(q) && Number.isFinite(c) ? q * c : null;
  };
  const grandTotal = sorted.reduce((sum, it) => sum + (lineTotal(it) ?? 0), 0);

  return (
    <div className="nbsc-form">
      <NbscFormHeader
        docCode="FM-NBSC-PMO-003"
        issueStatus="01"
        revNo="00"
        effectiveDate="07.25.2025"
      />

      <div className="nbsc-title">PURCHASE REQUEST</div>

      <div className="pr-entity">
        <span>Entity Name: <Line value={d.entity_name} /></span>
        <span className="pr-entity__fund">Fund Cluster: <Line value={d.fund_cluster} /></span>
      </div>

      <table className="pr-table">
        <colgroup>
          <col style={{ width: '16%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '37%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '15%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={2} rowSpan={2} style={{ height: '19mm' }}>
              <span className="pr-meta-label">Office/Section:</span>
              <span className="pr-meta-val nbsc-filled">{d.office_section || ''}</span>
            </td>
            <td colSpan={2}>
              <span className="pr-meta-label">PR No.</span>{' '}
              <span className="nbsc-filled">{d.pr_no || ''}</span>
            </td>
            <td colSpan={2} rowSpan={2}>
              <span className="pr-meta-label">Date:</span>
              <span className="pr-meta-val nbsc-filled">{fmtDate(d.pr_date)}</span>
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              <span className="pr-meta-label">Responsibility Center Code:</span>{' '}
              <span className="nbsc-filled">{d.responsibility_center_code || ''}</span>
            </td>
          </tr>
          <tr>
            <th>Stock/Property No.</th>
            <th>Unit</th>
            <th>Item Description</th>
            <th>Quantity</th>
            <th>Unit Cost</th>
            <th>Total Amount</th>
          </tr>
          {rows.map((it, i) => (
            <tr className="pr-row" key={it?.id ?? `blank-${i}`}>
              <td className="ctr nbsc-filled">{it?.stock_property_no || ''}</td>
              <td className="ctr nbsc-filled">{it?.unit || ''}</td>
              <td className="nbsc-filled">{it?.item_description || ''}</td>
              <td className="ctr nbsc-filled">{it ? it.quantity : ''}</td>
              <td className="num nbsc-filled">{it ? fmtMoney(it.unit_cost) : ''}</td>
              <td className="num nbsc-filled">{it ? fmtMoney(lineTotal(it)) : ''}</td>
            </tr>
          ))}
          <tr className="pr-row">
            <td /><td /><td />
            <td colSpan={3} style={{ fontWeight: 'bold' }}>
              PhP{' '}
              <span className="nbsc-filled" style={{ float: 'right' }}>
                {sorted.length ? fmtMoney(grandTotal) : ''}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="pr-purpose">
        Purpose: <Line value={d.purpose} />
      </div>

      <div className="pr-sign">
        <div>
          <div className="pr-sign__head">Requested by:</div>
          <div className="pr-sign__row"><span>Signature</span><span>:</span><Line value="" /></div>
          <div className="pr-sign__row"><span>Printed Name</span><span>:</span><Line value={d.requested_by_name} /></div>
          <div className="pr-sign__row"><span>Designation</span><span>:</span><Line value={d.requested_by_designation} /></div>
          <div className="pr-sign__row"><span>Date</span><span>:</span><Line value={fmtDate(d.requested_date)} /></div>
        </div>
        <div className="pr-sign__right">
          <div className="pr-sign__head" style={{ paddingLeft: 0 }}>Approved by:</div>
          <Line value="" />
          <Line value={d.approved_by_name} />
          <div style={{ marginTop: '0.8mm' }}>SUC President I</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1mm' }}>
            Date: <Line value={fmtDate(d.approved_date)} style={{ flex: 1, marginTop: 0 }} />
          </div>
        </div>
      </div>

      <NbscFormFooter />
    </div>
  );
}
