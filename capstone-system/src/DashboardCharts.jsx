/* =====================================================================
   DashboardCharts.jsx — the three graphs on the GSO dashboard
     StatusDonut         Functional / Needs attention / No Longer in Service
     TypeBars            per equipment type: functional vs needs attention
     InspectionWeeks     inspections in each of the last 4 weeks
   Plain SVG, no chart library. Colours come from the CSS variables.
   ===================================================================== */

const DAY_MS = 24 * 60 * 60 * 1000

function Legend({ items }) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

export function StatusDonut({ functional, needsAttention, retired }) {
  const total = functional + needsAttention + retired
  const r = 45
  const circ = 2 * Math.PI * r
  const parts = [
    { label: 'Functional', value: functional, color: 'var(--green)' },
    { label: 'Needs attention', value: needsAttention, color: 'var(--red)' },
    { label: 'No Longer in Service', value: retired, color: 'var(--chart-grey)' }
  ]
  let offset = 0

  return (
    <div className="chart-panel">
      <h3>Equipment status</h3>
      <div className="donut-row">
        <svg viewBox="0 0 120 120" width="130" height="130" role="img" aria-label="Equipment status">
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--border)" strokeWidth="16" />
          {total > 0 &&
            parts.map((p) => {
              if (p.value === 0) return null
              const len = (p.value / total) * circ
              const el = (
                <circle
                  key={p.label}
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="16"
                  strokeDasharray={`${len} ${circ}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 60 60)"
                />
              )
              offset += len
              return el
            })}
          <text x="60" y="58" textAnchor="middle" className="donut-value">
            {functional + needsAttention}
          </text>
          <text x="60" y="74" textAnchor="middle" className="chart-text">
            in service
          </text>
        </svg>
        <ul className="donut-list">
          {parts.map((p) => (
            <li key={p.label}>
              <i style={{ background: p.color }} />
              {p.label} <b>{p.value}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0)

// Equipment by type — the original bar graph look, with the adviser's added
// numbers: each bar shows Functional (green) and Defective (red), and next
// to it the counts with their percentage of that type's total, the total,
// how many are No Longer in Service, and new units in the storeroom.
// rows: [{ type, label, ok, bad, retired, storeroom }]
//   ok / bad   in-service units: Functional / Defective (any status other
//              than Functional, except No Longer in Service). Total = ok + bad,
//              the same "Total Equipment" as the stat card.
//   retired    No Longer in Service — counted, not part of total or %
//   storeroom  new units in the GSO storeroom (Stock page), not installed
// Each status changes by itself as inspectors and technicians work.
// Drawn with HTML rather than one scaled SVG picture, so the text stays a
// readable size however wide the card is (the SVG version shrank its text
// to fit the dashboard card).
export function TypeBars({ rows }) {
  const typeRows = rows.filter((r) => r.ok + r.bad + r.retired + (r.storeroom || 0) > 0)
  const all = typeRows.reduce(
    (s, r) => ({
      ...s,
      ok: s.ok + r.ok,
      bad: s.bad + r.bad,
      retired: s.retired + r.retired,
      storeroom: s.storeroom + (r.storeroom || 0)
    }),
    { type: '__all__', label: 'All equipment', ok: 0, bad: 0, retired: 0, storeroom: 0 }
  )
  const shown = typeRows.length ? [all, ...typeRows] : []
  // Type bars share one scale so they compare; "All equipment" fills its own.
  const max = Math.max(1, ...typeRows.map((r) => r.ok + r.bad))

  return (
    <div className="chart-panel chart-wide">
      <h3>Equipment by type</h3>
      {shown.length === 0 ? (
        <p className="chart-empty">No equipment yet.</p>
      ) : (
        <div className="tb-list" role="list" aria-label="Equipment by type">
          {shown.map((r) => {
            const isAll = r.type === '__all__'
            const total = r.ok + r.bad
            const scale = isAll ? Math.max(1, total) : max
            const extra = [
              `Total ${total}`,
              `${r.retired} no longer in service`,
              r.storeroom > 0 ? `+${r.storeroom} new in storeroom` : null
            ].filter(Boolean)
            return (
              <div key={r.type} role="listitem" className={`tb-row ${isAll ? 'tb-all' : ''}`}>
                <span className="tb-label" title={r.label}>
                  {r.label}
                </span>
                <span className="tb-bar" aria-hidden="true">
                  {r.ok > 0 && <i style={{ width: `${(r.ok / scale) * 100}%`, background: 'var(--green)' }} />}
                  {r.bad > 0 && <i style={{ width: `${(r.bad / scale) * 100}%`, background: 'var(--red)' }} />}
                </span>
                <span className="tb-text">
                  <span className="tb-main">
                    <span className="chart-ok">
                      {r.ok} functional ({pct(r.ok, total)}%)
                    </span>
                    {' · '}
                    <span className="chart-bad">
                      {r.bad} defective ({pct(r.bad, total)}%)
                    </span>
                  </span>
                  <span className="tb-sub">{extra.join(' · ')}</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
      <div className="chart-legend">
        <span><i style={{ background: 'var(--green)' }} />Functional</span>
        <span><i style={{ background: 'var(--red)' }} />Defective</span>
        <span>% = share of that type&apos;s total in service</span>
      </div>
    </div>
  )
}
function shortDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Four 7-day windows ending now (the newest is the last 7 days — the same
// window as "This week" elsewhere).
export function InspectionWeeks({ inspections }) {
  const now = new Date().getTime()
  const weeks = [3, 2, 1, 0].map((k) => {
    const end = now - k * 7 * DAY_MS
    const start = end - 7 * DAY_MS
    let ok = 0
    let bad = 0
    inspections.forEach((i) => {
      const t = new Date(i.inspection_date).getTime()
      if (t > start && t <= end) {
        if (i.condition_status === 'defective') bad += 1
        else ok += 1
      }
    })
    return {
      ok,
      bad,
      label: `${shortDate(new Date(start + DAY_MS))} – ${shortDate(new Date(end))}`
    }
  })
  const max = Math.max(4, ...weeks.map((w) => w.ok + w.bad))
  const share = (v) => `${(v / max) * 100}%`

  // HTML columns (not a scaled SVG), so numbers and dates stay readable.
  return (
    <div className="chart-panel chart-wide">
      <h3>Inspections, last 4 weeks</h3>
      <div className="iw-chart" role="img" aria-label={weeks.map((w) => `${w.label}: ${w.ok + w.bad}`).join(', ')}>
        <div className="iw-plot">
          {[1, 0.5].map((f) => (
            <span key={f} className="iw-grid" style={{ bottom: share(max * f) }}>
              <b>{Math.round(max * f)}</b>
            </span>
          ))}
          <span className="iw-grid iw-zero" style={{ bottom: 0 }}>
            <b>0</b>
          </span>
          {weeks.map((w) => (
            <div key={w.label} className="iw-col">
              <span className="iw-total" style={{ bottom: share(w.ok + w.bad) }}>
                {w.ok + w.bad}
              </span>
              <span className="iw-stack" style={{ height: share(w.ok + w.bad) }}>
                {w.bad > 0 && <i style={{ flexGrow: w.bad, background: 'var(--red)' }} />}
                {w.ok > 0 && <i style={{ flexGrow: w.ok, background: 'var(--green)' }} />}
              </span>
            </div>
          ))}
        </div>
        <div className="iw-dates">
          {weeks.map((w) => (
            <span key={w.label}>{w.label}</span>
          ))}
        </div>
      </div>
      <Legend
        items={[
          { label: 'Functional', color: 'var(--green)' },
          { label: 'Defective', color: 'var(--red)' }
        ]}
      />
    </div>
  )
}
