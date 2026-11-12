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
  const labelW = 118
  const barW = 200
  const textX = labelW + barW + 12
  const rowH = 42
  const height = Math.max(rowH, shown.length * rowH)

  return (
    <div className="chart-panel chart-wide">
      <h3>Equipment by type</h3>
      {shown.length === 0 ? (
        <p className="chart-empty">No equipment yet.</p>
      ) : (
        <svg viewBox={`0 0 760 ${height}`} className="chart-svg" role="img" aria-label="Equipment by type">
          {shown.map((r, i) => {
            const isAll = r.type === '__all__'
            const total = r.ok + r.bad
            const scale = isAll ? Math.max(1, total) : max
            const y = i * rowH + 8
            const okW = (r.ok / scale) * barW
            const badW = (r.bad / scale) * barW
            const extra = [
              `Total ${total}`,
              `${r.retired} no longer in service`,
              r.storeroom > 0 ? `+${r.storeroom} new in storeroom` : null
            ].filter(Boolean)
            return (
              <g key={r.type}>
                {isAll && <line x1="0" y1={rowH - 1} x2="760" y2={rowH - 1} stroke="var(--border)" />}
                <text x="0" y={y + 12} className={`chart-text ${isAll ? 'chart-strong' : ''}`}>
                  {r.label.length > 17 ? `${r.label.slice(0, 16)}…` : r.label}
                </text>
                <rect x={labelW} y={y} width={barW} height="16" rx="2" fill="var(--border)" opacity="0.45" />
                {okW > 0 && <rect x={labelW} y={y} width={okW} height="16" rx="2" fill="var(--green)" />}
                {badW > 0 && <rect x={labelW + okW} y={y} width={badW} height="16" rx="2" fill="var(--red)" />}
                <text x={textX} y={y + 12} className="chart-text">
                  <tspan className="chart-ok">{r.ok} functional ({pct(r.ok, total)}%)</tspan>
                  <tspan> · </tspan>
                  <tspan className="chart-bad">{r.bad} defective ({pct(r.bad, total)}%)</tspan>
                </text>
                <text x={textX} y={y + 28} className="chart-text chart-small">
                  {extra.join(' · ')}
                </text>
              </g>
            )
          })}
        </svg>
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
  const top = 14
  const bottom = 100
  const h = bottom - top
  const yFor = (v) => bottom - (v / max) * h
  const colW = 470 / 4

  return (
    <div className="chart-panel chart-wide">
      <h3>Inspections, last 4 weeks</h3>
      <svg viewBox="0 0 520 120" className="chart-svg" role="img" aria-label="Inspections, last 4 weeks">
        <line x1="40" y1={bottom} x2="510" y2={bottom} stroke="var(--border)" />
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1="40" y1={yFor(max * f)} x2="510" y2={yFor(max * f)} stroke="var(--border)" strokeDasharray="3 3" />
            <text x="32" y={yFor(max * f) + 4} textAnchor="end" className="chart-text">
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <text x="32" y={bottom + 4} textAnchor="end" className="chart-text">0</text>
        {weeks.map((w, i) => {
          const x = 40 + i * colW + colW / 2 - 25
          const okTop = yFor(w.ok)
          const badTop = yFor(w.ok + w.bad)
          return (
            <g key={w.label}>
              {w.ok > 0 && <rect x={x} y={okTop} width="50" height={bottom - okTop} fill="var(--green)" />}
              {w.bad > 0 && <rect x={x} y={badTop} width="50" height={okTop - badTop} fill="var(--red)" />}
              <text x={x + 25} y={badTop - 4} textAnchor="middle" className="chart-text chart-strong">
                {w.ok + w.bad}
              </text>
              <text x={x + 25} y="116" textAnchor="middle" className="chart-text">
                {w.label}
              </text>
            </g>
          )
        })}
      </svg>
      <Legend
        items={[
          { label: 'Functional', color: 'var(--green)' },
          { label: 'Defective', color: 'var(--red)' }
        ]}
      />
    </div>
  )
}
