/* =====================================================================
   DashboardOverview.jsx — the top of the GSO dashboard (version A, in
   version D's card style)

     DashboardGreeting  greeting, today's date and two shortcuts
     ComplianceRing     share of units functional AND inspected in 30 days
     PriorityQueue      the most urgent open Priority Actions
     LiveActivity       the newest things inspectors / technicians did
     RoundsProgress     units inspected this month, per building
     StaffOnDuty        who is available, on a job or on leave today

   Everything is worked out from data the dashboard already loads.
   ===================================================================== */

const DAY_MS = 24 * 60 * 60 * 1000
const TYPE_LABELS = {
  fire_extinguisher: 'Fire Extinguisher',
  fire_alarm: 'Fire Alarm',
  sprinkler: 'Sprinkler',
  emergency_light: 'Emergency Light',
  smoke_detector: 'Smoke Detector'
}
const typeName = (t) => TYPE_LABELS[t] || (t ? t.replace(/_/g, ' ') : 'Equipment')
const inService = (e) => e.current_status !== 'no_longer_in_service'

function ago(dateString) {
  if (!dateString) return ''
  const diff = Date.now() - new Date(dateString).getTime()
  if (diff < 60 * 1000) return 'just now'
  const min = Math.round(diff / 60000)
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/* ------------------------------------------------------------------ */

export function DashboardGreeting({ name, onAssignJob, onAssignInspection }) {
  const now = new Date()
  const hour = now.getHours()
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const first = (name || '').trim().split(/\s+/)[0]
  return (
    <div className="dash-greeting">
      <div>
        <h1>
          {part}
          {first ? `, ${first}` : ''}
        </h1>
        <p>
          {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>
      <div className="dash-greeting-actions">
        <button className="btn btn-primary" onClick={onAssignJob}>
          Assign job order
        </button>
        <button className="btn btn-secondary" onClick={onAssignInspection}>
          Assign inspection
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

// "Ready" = in service, Functional, and inspected in the last 30 days
// (NFPA 10's monthly inspection).
export function ComplianceRing({ equipment = [], inspections = [] }) {
  const units = equipment.filter(inService)
  const lastInspected = {}
  inspections.forEach((i) => {
    if (!i.equipment_id || !i.inspection_date) return
    const t = new Date(i.inspection_date).getTime()
    if (!lastInspected[i.equipment_id] || t > lastInspected[i.equipment_id]) lastInspected[i.equipment_id] = t
  })
  const since = new Date().getTime() - 30 * DAY_MS
  const recent = (e) => (lastInspected[e.id] || 0) >= since
  const ready = units.filter((e) => e.current_status === 'functional' && recent(e)).length
  const notChecked = units.filter((e) => e.current_status === 'functional' && !recent(e)).length
  const defective = units.filter((e) => e.current_status !== 'functional').length
  const pct = units.length ? Math.round((ready / units.length) * 100) : 0

  const r = 54
  const circ = 2 * Math.PI * r
  const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--amber)' : 'var(--red)'

  return (
    <section className="dash-card dash-ring" aria-labelledby="dash-ring-title">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`Compliance score ${pct} percent`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--border)" strokeWidth="14" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * circ} ${circ}`}
          transform="rotate(-90 70 70)"
        />
        <text x="70" y="68" textAnchor="middle" className="dash-ring-value">
          {pct}%
        </text>
        <text x="70" y="90" textAnchor="middle" className="dash-ring-label">
          ready
        </text>
      </svg>
      <div className="dash-ring-text">
        <h2 id="dash-ring-title">Compliance score</h2>
        <p>
          {ready} of {units.length} units in service are functional and were inspected in the last 30 days.
        </p>
        <ul>
          <li>
            <i style={{ background: 'var(--amber)' }} />
            {notChecked} functional, not inspected in 30 days
          </li>
          <li>
            <i style={{ background: 'var(--red)' }} />
            {defective} need attention
          </li>
        </ul>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

const PRIORITY_COLOR = { critical: 'var(--red)', high: '#ea580c', medium: 'var(--amber)', low: 'var(--blue)' }

function stageOf(action, needsPurchase) {
  if (action.status === 'pending') return needsPurchase ? 'Needs Purchase Request' : 'Needs a Job Order'
  if (action.status === 'unresolved') return 'Unresolved'
  if (action.status === 'for_disposal') return 'For disposal'
  if (action.repair_status === 'repaired') return 'Verify repair'
  if (action.repair_status === 'working') return 'Working on it'
  return 'Assigned'
}

export function PriorityQueue({ actions = [], purchaseItems = [], technicians = [], onOpen, onSeeAll, limit = 5 }) {
  const shown = actions.slice(0, limit)
  return (
    <section className="dash-card dash-span-2" aria-labelledby="dash-queue-title">
      <div className="dash-card-head">
        <h2 id="dash-queue-title">Priority queue</h2>
        <span className="dash-muted">Most urgent first</span>
      </div>
      {shown.length === 0 ? (
        <p className="dash-empty">✓ No open defects. All equipment accounted for.</p>
      ) : (
        <div className="dash-list">
          {shown.map((a) => {
            const needsPurchase = purchaseItems.some((p) => p.actionId === a.id)
            const tech = technicians.find((t) => t.id === a.assigned_technician_id)
            const where = [a.equipment?.buildings?.building_name, a.equipment?.exact_location].filter(Boolean).join(', ')
            return (
              <button key={a.id} className="dash-queue-item" onClick={() => onOpen(a)}>
                <span className="dash-stripe" style={{ background: PRIORITY_COLOR[a.priority] || 'var(--chart-grey)' }} />
                <span className="dash-queue-main">
                  <span className="dash-queue-title">
                    {a.equipment?.equipment_code || 'Equipment'} · {typeName(a.equipment?.equipment_type)}
                    {where && <span className="dash-muted"> · {where}</span>}
                  </span>
                  <span className="dash-muted">
                    {a.description}
                    {tech ? ` · ${tech.full_name}` : ''} · reported {ago(a.reported_date)}
                  </span>
                </span>
                <span className={`dash-pill dash-pill-${a.priority}`}>
                  {(a.priority || '').charAt(0).toUpperCase() + (a.priority || '').slice(1)} · {stageOf(a, needsPurchase)}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {actions.length > limit && (
        <button className="dash-link" onClick={onSeeAll}>
          See all {actions.length} in Priority Actions
        </button>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

const TONE_DOT = { red: 'var(--red)', amber: 'var(--amber)', green: 'var(--green)', blue: 'var(--blue)' }

// The newest events from the notification list, without the standing
// reminders (expiry dates, purchase requests).
export function LiveActivity({ notifications = [], onOpen, limit = 6 }) {
  const now = new Date().getTime()
  const events = notifications
    .filter((n) => n.time && n.target !== 'expiry' && n.target !== 'purchase' && new Date(n.time).getTime() <= now)
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, limit)
  return (
    <section className="dash-card" aria-labelledby="dash-live-title">
      <div className="dash-card-head">
        <h2 id="dash-live-title">Live activity</h2>
        <span className="dash-pill dash-pill-live">● Live</span>
      </div>
      {events.length === 0 ? (
        <p className="dash-empty">Nothing new in the last few days.</p>
      ) : (
        <div className="dash-list">
          {events.map((n) => (
            <button key={n.id} className="dash-event" onClick={() => onOpen(n)}>
              <i style={{ background: TONE_DOT[n.tone] || 'var(--chart-grey)' }} />
              <span>
                <span className="dash-event-title">{n.title}</span>
                <span className="dash-muted">{ago(n.time)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

export function RoundsProgress({ equipment = [], inspections = [], buildings = [] }) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const checked = new Set(
    inspections
      .filter((i) => i.inspection_date && new Date(i.inspection_date).getTime() >= monthStart)
      .map((i) => i.equipment_id)
  )
  const rows = buildings
    .map((b) => {
      const units = equipment.filter((e) => inService(e) && e.building_id === b.id)
      const done = units.filter((e) => checked.has(e.id)).length
      return { id: b.id, name: b.building_name, total: units.length, done }
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => a.done / a.total - b.done / b.total)
  const month = now.toLocaleDateString(undefined, { month: 'long' })

  return (
    <section className="dash-card" aria-labelledby="dash-rounds-title">
      <h2 id="dash-rounds-title">{month} inspection rounds</h2>
      {rows.length === 0 ? (
        <p className="dash-empty">No equipment in any building yet.</p>
      ) : (
        <div className="dash-list">
          {rows.map((r) => {
            const pct = Math.round((r.done / r.total) * 100)
            return (
              <div key={r.id} className="dash-round">
                <span className="dash-round-name">{r.name}</span>
                <span className="dash-bar">
                  <i style={{ width: `${pct}%`, background: pct === 100 ? 'var(--green)' : 'var(--blue)' }} />
                </span>
                <span className={r.done === 0 ? 'dash-round-count dash-round-none' : 'dash-round-count'}>
                  {r.done} / {r.total}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

// Expiring soon (panel comment): every unit in service expiring within 90
// days, or already expired, in four groups, with the storeroom stock that
// can replace them. items come with daysLeft, soonest first.
const EXPIRY_GROUPS = [
  { key: 'expired', title: 'Expired', test: (d) => d < 0, color: 'var(--red)', bg: 'var(--red-bg)' },
  { key: 'week', title: 'This week', test: (d) => d >= 0 && d <= 7, color: 'var(--red)', bg: 'var(--red-bg)' },
  { key: 'month', title: 'Within 30 days', test: (d) => d > 7 && d <= 30, color: 'var(--amber)', bg: 'var(--amber-bg)' },
  { key: 'quarter', title: 'Within 90 days', test: (d) => d > 30 && d <= 90, color: 'var(--blue)', bg: 'var(--blue-light)' }
]

function shortYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '')
  if (!m) return ymd || ''
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

export function ExpiringSoon({ items = [], stock = [], onOpen }) {
  const types = [...new Set(items.map((i) => i.equipment_type))]
  const onHand = types.map((t) => ({
    type: t,
    qty: stock.find((s) => s.equipment_type === t)?.quantity_available ?? 0
  }))
  return (
    <section className="dash-card dash-span-all" aria-labelledby="dash-expiry-title">
      <div className="dash-card-head">
        <h2 id="dash-expiry-title">Expiring soon · next 90 days</h2>
        <button className="dash-link" onClick={onOpen}>
          Open the Expiring / Expired report
        </button>
      </div>
      {items.length === 0 ? (
        <p className="dash-empty">✓ Nothing expires in the next 90 days.</p>
      ) : (
        <>
          <div className="dash-expiry-groups">
            {EXPIRY_GROUPS.map((g) => {
              const list = items.filter((i) => g.test(i.daysLeft))
              return (
                <div key={g.key} className="dash-expiry-group">
                  <div className="dash-expiry-head" style={{ color: g.color }}>
                    {g.title} <span className="dash-expiry-count" style={{ background: g.bg }}>{list.length}</span>
                  </div>
                  {list.length === 0 ? (
                    <span className="dash-muted">None</span>
                  ) : (
                    list.map((i) => (
                      <button key={i.id} className="dash-expiry-item" onClick={onOpen}>
                        <span className="dash-queue-title">
                          {i.equipment_code} <span className="dash-muted">· {typeName(i.equipment_type)}</span>
                        </span>
                        <span className="dash-muted">
                          {shortYmd(i.expiration_date)}
                          {i.buildings?.building_name ? ` · ${i.buildings.building_name}` : ''}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )
            })}
          </div>
          <div className="dash-muted">
            In the storeroom: {onHand.map((o) => `${o.qty} ${typeName(o.type)}`).join(' · ')}
          </div>
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

// people: [{ id, name, role, available, reason, onJob, onLeave }]
export function StaffOnDuty({ people = [] }) {
  return (
    <section className="dash-card" aria-labelledby="dash-staff-title">
      <h2 id="dash-staff-title">Staff on duty</h2>
      {people.length === 0 ? (
        <p className="dash-empty">No inspector or technician accounts yet.</p>
      ) : (
        <div className="dash-list">
          {people.map((p) => {
            const status = p.onLeave
              ? ['On leave today', 'dash-pill-leave']
              : !p.available
                ? ['Unavailable', 'dash-pill-leave']
                : p.onJob
                  ? ['On a job', 'dash-pill-job']
                  : ['Available', 'dash-pill-ok']
            return (
              <div key={p.id} className="dash-staff">
                <span>
                  {p.name} <span className="dash-muted">· {p.role}</span>
                  {!p.available && p.reason && <span className="dash-staff-reason">{p.reason}</span>}
                </span>
                <span className={`dash-pill ${status[1]}`}>{status[0]}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
