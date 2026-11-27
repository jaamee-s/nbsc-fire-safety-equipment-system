/* =====================================================================
   ReportsTab.jsx — the Reports page
   Pick a report, set its filters (same look as the Equipment Inventory
   filters), check the preview, then Print Report. The preview and the
   printed sheet are the same table.
   ===================================================================== */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import {
  ACTION_STATUS_LABELS,
  CHANGE_AREAS,
  PRIORITIES,
  REPORTS,
  RESULT_LABELS,
  buildReport,
  cleanInspectorName,
  defaultFilters
} from './reports'

const PREVIEW_LIMIT = 50

function Field({ label, children }) {
  return (
    <div className="report-field">
      <label className="field-label">{label}</label>
      {children}
    </div>
  )
}

export function ReportsTab({
  equipment,
  buildings,
  inspections,
  actions,
  technicians,
  purchaseItems,
  types,
  statusOptions,
  ctx,
  summaryRows,
  onPrint,
  onOpenSummary,
  initialReport = 'inventory'
}) {
  const [reportKey, setReportKey] = useState(initialReport)
  const [filters, setFilters] = useState(defaultFilters(initialReport))
  // Inspection assignments (migration 010): the priority of an inspection
  // done for one. Empty before 010 is run.
  const [assignments, setAssignments] = useState([])

  useEffect(() => {
    supabase
      .from('inspection_assignments')
      .select('id, inspector_id, building_id, floor_label, priority, created_at')
      .eq('status', 'open')
      .then(({ data, error }) => {
        if (!error) setAssignments(data || [])
      })
  }, [])
  // Change Log (migration 023): the newest 2,000 admin changes, loaded when
  // that report is opened. Empty (with a note) before 023 is run.
  const [changeLog, setChangeLog] = useState(null)
  const [changeLogError, setChangeLogError] = useState(null)
  useEffect(() => {
    if (reportKey !== 'changes') return
    let alive = true
    supabase
      .from('change_log')
      .select('id, changed_at, actor_name, actor_role, table_name, row_label, action, changes')
      .order('changed_at', { ascending: false })
      .limit(2000)
      .then(({ data, error }) => {
        if (!alive) return
        setChangeLogError(error ? 'The change log appears once migration 023_change_log.sql is run in Supabase.' : null)
        setChangeLog(error ? [] : data || [])
      })
    return () => {
      alive = false
    }
  }, [reportKey])
  const changePeople = useMemo(
    () => [...new Set((changeLog || []).map((c) => c.actor_name || 'Unknown'))].sort((a, b) => a.localeCompare(b)),
    [changeLog]
  )

  const info = REPORTS.find((r) => r.key === reportKey)

  function chooseReport(key) {
    setReportKey(key)
    setFilters(defaultFilters(key))
  }

  const set = (name) => (e) => setFilters((prev) => ({ ...prev, [name]: e.target.value }))

  const inspectorNames = useMemo(
    () => [...new Set(inspections.map((i) => cleanInspectorName(i.inspector_name)))].sort((a, b) => a.localeCompare(b)),
    [inspections]
  )

  const report = useMemo(
    () =>
      reportKey === 'summary'
        ? null
        : buildReport(
            reportKey,
            filters,
            { equipment, inspections, actions, technicians, purchaseItems, assignments, changeLog: changeLog || [] },
            { ...ctx, buildings }
          ),
    [reportKey, filters, equipment, inspections, actions, technicians, purchaseItems, assignments, changeLog, ctx, buildings]
  )

  const datesBackwards = filters.from && filters.to && filters.from > filters.to
  const count = reportKey === 'summary' ? 1 : report?.total ?? 0

  const typeSelect = (
    <Field label="Equipment Type">
      <select value={filters.type} onChange={set('type')}>
        <option value="">All Types</option>
        {types.map((t) => (
          <option key={t} value={t}>{ctx.typeLabel(t)}</option>
        ))}
      </select>
    </Field>
  )
  const buildingSelect = (
    <Field label="Building">
      <select value={filters.building} onChange={set('building')}>
        <option value="">All Buildings</option>
        {buildings.map((b) => (
          <option key={b.id} value={b.id}>{b.building_name}</option>
        ))}
      </select>
    </Field>
  )
  const dateFields = (
    <>
      <Field label="From">
        <input type="date" value={filters.from} onChange={set('from')} />
      </Field>
      <Field label="To">
        <input type="date" value={filters.to} onChange={set('to')} />
      </Field>
    </>
  )

  return (
    <div>
      <div className="section-heading">
        <h2>Reports</h2>
        <button
          className="btn btn-secondary btn-sm"
          disabled={reportKey !== 'summary' && (count === 0 || datesBackwards)}
          onClick={() => (reportKey === 'summary' ? onOpenSummary() : onPrint(report))}
          title={reportKey === 'summary' ? 'Opens the System Summary, which has its own Print Summary button.' : 'Prints the table shown below, using the filters above.'}
        >
          🖨 {reportKey === 'summary' ? 'Open Summary to print' : `Print Report (${count})`}
        </button>
      </div>

      <div className="panel report-filters">
        <Field label="Report">
          <select className="report-picker" value={reportKey} onChange={(e) => chooseReport(e.target.value)}>
            {REPORTS.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </Field>

        {reportKey !== 'summary' && (
          <div className="report-filter-row">
            {reportKey === 'inventory' && (
              <>
                {typeSelect}
                <Field label="Status">
                  <select value={filters.status} onChange={set('status')}>
                    <option value="">All Statuses</option>
                    <option value="__needs_attention__">Needs attention</option>
                    {statusOptions.map((s) => (
                      <option key={s} value={s}>{ctx.statusLabel(s)}</option>
                    ))}
                  </select>
                </Field>
                {buildingSelect}
              </>
            )}

            {reportKey === 'inspection' && (
              <>
                {dateFields}
                <Field label="Inspector">
                  <select value={filters.inspector} onChange={set('inspector')}>
                    <option value="">All Inspectors</option>
                    {inspectorNames.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={filters.status} onChange={set('status')}>
                    <option value="">All Statuses</option>
                    {Object.entries(RESULT_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={filters.priority} onChange={set('priority')}>
                    <option value="">All Priorities</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                    <option value="__none__">No priority</option>
                  </select>
                </Field>
                {buildingSelect}
              </>
            )}

            {reportKey === 'repairs' && (
              <>
                {dateFields}
                <Field label="Technician">
                  <select value={filters.technician} onChange={set('technician')}>
                    <option value="">All Technicians</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.full_name}</option>
                    ))}
                    <option value="__none__">Not assigned</option>
                  </select>
                </Field>
                <Field label="Status">
                  <select value={filters.status} onChange={set('status')}>
                    <option value="">All Statuses</option>
                    {Object.entries(ACTION_STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={filters.priority} onChange={set('priority')}>
                    <option value="">All Priorities</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            {reportKey === 'purchase' && (
              <>
                {typeSelect}
                {buildingSelect}
              </>
            )}

            {reportKey === 'expiry' && (
              <>
                <Field label="Show">
                  <select value={filters.show} onChange={set('show')}>
                    <option value="both">Expiring + Expired</option>
                    <option value="expiring">Expiring only</option>
                    <option value="expired">Expired only</option>
                  </select>
                </Field>
                <Field label="Within">
                  <select value={filters.within} onChange={set('within')} disabled={filters.show === 'expired'}>
                    <option value="30">30 days</option>
                    <option value="60">60 days</option>
                    <option value="90">90 days</option>
                  </select>
                </Field>
                {typeSelect}
                {buildingSelect}
              </>
            )}

            {reportKey === 'changes' && (
              <>
                {dateFields}
                <Field label="Area">
                  <select value={filters.area} onChange={set('area')}>
                    <option value="">All areas</option>
                    {Object.entries(CHANGE_AREAS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Changed by">
                  <select value={filters.person} onChange={set('person')}>
                    <option value="">Everyone</option>
                    {changePeople.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
          </div>
        )}
        {reportKey === 'changes' && changeLogError && <p className="form-error">{changeLogError}</p>}
      </div>

      <div className="report-preview-head">
        <strong>{info.label}</strong>
        <span>{info.description}</span>
      </div>

      {datesBackwards ? (
        <p className="form-error">The "From" date is after the "To" date.</p>
      ) : reportKey === 'summary' ? (
        <div className="table-wrap">
          <table className="data-table">
            <tbody>
              {summaryRows.map(([label, value]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num"><strong>{value}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : report.rows.length === 0 ? (
        <div className="all-clear-banner">Nothing matches these filters.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {report.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.slice(0, PREVIEW_LIMIT).map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="report-note">
            {report.rows.length > PREVIEW_LIMIT
              ? `Preview shows the first ${PREVIEW_LIMIT} of ${report.rows.length}. Print Report includes all ${report.rows.length}.`
              : `${report.rows.length} ${report.unit}${report.rows.length === 1 ? '' : 's'}.`}
          </p>
        </>
      )}
    </div>
  )
}
