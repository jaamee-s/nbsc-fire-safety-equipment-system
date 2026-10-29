import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'

/* 
   Exports:
     buildGsoNotifications   builds the GSO notification list
     NotificationBell        bell button + dropdown for the header
     SummaryModal            the "Summary" view
     InspectorsTab           the Inspectors sidebar page
     JobOrderRequestModal    the Job Order Request form
   ===================================================================== */

const TYPE_LABELS = {
  fire_extinguisher: 'Fire Extinguisher',
  fire_alarm: 'Fire Alarm',
  sprinkler: 'Sprinkler',
  emergency_light: 'Emergency Light',
  smoke_detector: 'Smoke Detector'
}

const ACTION_TYPE_LABELS = {
  repair: 'Repair',
  replace: 'Replace',
  battery_replacement: 'Battery Replacement',
  refill: 'Refill',
  inspection: 'Inspection',
  other: 'Other'
}

function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function ago(dateString) {
  if (!dateString) return ''
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

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

// Everything here is derived from data the dashboard already loads, so no
// database change is needed. Ids include the stage, so when something moves
// to a new stage (e.g. technician marks it repaired) it shows up as unread again.
export function buildGsoNotifications({ actions = [], expiring = [] }) {
  const list = []

  actions.forEach((a) => {
    const code = a.equipment?.equipment_code || 'Equipment'
    const where = `${a.equipment?.buildings?.building_name ?? 'N/A'} — ${a.equipment?.exact_location ?? ''}`

    if (a.status === 'pending') {
      list.push({
        id: `pending-${a.id}`,
        tone: a.priority === 'critical' || a.priority === 'high' ? 'red' : 'amber',
        title: `New defect reported: ${code}`,
        detail: `${a.description} (${a.priority} priority) · ${where}`,
        next: 'File a Job Order Request so a technician can be assigned.',
        time: a.reported_date,
        target: 'priority'
      })
    }

    if (a.status === 'in_progress' && a.repair_status === 'repaired') {
      list.push({
        id: `repaired-${a.id}`,
        tone: 'green',
        title: `Technician marked ${code} as repaired`,
        detail: a.repair_note ? `Technician note: "${a.repair_note}"` : where,
        next: 'Verify the unit, then open Record Outcome / Close Work.',
        time: a.repaired_at || a.reported_date,
        target: 'priority'
      })
    }

    if (a.status === 'in_progress' && a.repair_status === 'working') {
      list.push({
        id: `working-${a.id}`,
        tone: 'blue',
        title: `Technician started working on ${code}`,
        detail: where,
        next: 'No action needed yet. You will be notified when it is marked repaired.',
        time: a.decided_at || a.reported_date,
        target: 'priority'
      })
    }

    if (a.status === 'unresolved') {
      list.push({
        id: `unresolved-${a.id}`,
        tone: 'red',
        title: `${code} is marked Unresolved`,
        detail: a.outcome_reason ? `Reason: "${a.outcome_reason}"` : where,
        next: 'Reassess the action to try a different repair route.',
        time: a.outcome_at || a.reported_date,
        target: 'priority'
      })
    }
  })

  expiring.forEach((item) => {
    const expired = item.daysLeft < 0
    list.push({
      id: `expiry-${item.id}-${item.expiration_date}`,
      tone: expired ? 'red' : 'amber',
      title: expired
        ? `${item.equipment_code} has expired`
        : `${item.equipment_code} expires ${item.daysLeft === 0 ? 'today' : `in ${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'}`}`,
      detail: `${TYPE_LABELS[item.equipment_type] || item.equipment_type} · ${item.buildings?.building_name ?? 'N/A'} — ${item.exact_location ?? ''}`,
      next: 'Arrange a replacement or refill with the Supply Office.',
      time: item.expiration_date,
      target: 'expiry'
    })
  })

  return list.sort((x, y) => {
    if (!x.time && !y.time) return 0
    if (!x.time) return 1
    if (!y.time) return -1
    return new Date(y.time) - new Date(x.time)
  })
}

const TONE = {
  red: { bar: '#dc2626', bg: '#fef2f2' },
  amber: { bar: '#d97706', bg: '#fffbeb' },
  green: { bar: '#16a34a', bg: '#f0fdf4' },
  blue: { bar: '#2563eb', bg: '#eff6ff' }
}

const SEEN_KEY = 'gso-seen-notifications'

function loadSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
}

function saveSeen(list) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-500)))
  } catch (e) {
    /* storage unavailable — read state just won't persist */
  }
}

export function NotificationBell({ notifications, onNavigate }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(loadSeen)

  const seenSet = useMemo(() => new Set(seen), [seen])
  const unread = notifications.filter((n) => !seenSet.has(n.id)).length

  function markSeen(id) {
    if (seenSet.has(id)) return
    const next = [...seen, id]
    setSeen(next)
    saveSeen(next)
  }

  function markAll() {
    const next = [...new Set([...seen, ...notifications.map((n) => n.id)])]
    setSeen(next)
    saveSeen(next)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="logout-btn"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label="Notifications"
        style={{ position: 'relative', marginRight: '6px' }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              background: '#dc2626',
              color: '#fff',
              fontSize: '0.68rem',
              fontWeight: 700,
              minWidth: '18px',
              height: '18px',
              lineHeight: '18px',
              borderRadius: '999px',
              textAlign: 'center',
              padding: '0 4px'
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 998 }}
          />
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 10px)',
              width: '380px',
              maxWidth: '92vw',
              maxHeight: '480px',
              overflowY: 'auto',
              background: '#fff',
              color: '#1e293b',
              border: '1px solid #e3e8ef',
              borderRadius: '12px',
              boxShadow: '0 12px 32px rgba(15,42,74,0.25)',
              zIndex: 999,
              textAlign: 'left'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                borderBottom: '1px solid #e3e8ef',
                position: 'sticky',
                top: 0,
                background: '#fff'
              }}
            >
              <strong style={{ fontSize: '0.95rem' }}>Notifications</strong>
              <button
                className="btn btn-secondary btn-sm"
                onClick={markAll}
                disabled={unread === 0}
              >
                Mark all as read
              </button>
            </div>

            {notifications.length === 0 ? (
              <p style={{ padding: '18px 14px', margin: 0, color: '#64748b', fontSize: '0.88rem' }}>
                You&apos;re all caught up. Nothing needs your attention.
              </p>
            ) : (
              notifications.map((n) => {
                const isUnread = !seenSet.has(n.id)
                const tone = TONE[n.tone] || TONE.blue
                return (
                  <div
                    key={n.id}
                    onClick={() => {
                      markSeen(n.id)
                      setOpen(false)
                      onNavigate && onNavigate(n.target)
                    }}
                    style={{
                      cursor: 'pointer',
                      padding: '11px 14px',
                      borderBottom: '1px solid #eef1f5',
                      borderLeft: `4px solid ${tone.bar}`,
                      background: isUnread ? tone.bg : '#fff'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontWeight: isUnread ? 700 : 600, fontSize: '0.88rem' }}>
                        {n.title}
                      </span>
                      {isUnread && (
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: tone.bar,
                            flexShrink: 0,
                            marginTop: '5px'
                          }}
                        />
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                      {n.detail}
                    </div>
                    <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                      <strong>Next:</strong> {n.next}
                    </div>
                    {n.time && (
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '3px' }}>
                        {ago(n.time)}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Summary view                                                        */
/* ------------------------------------------------------------------ */

function Tile({ label, value, color }) {
  return (
    <div
      style={{
        border: '1px solid #e3e8ef',
        borderRadius: '10px',
        padding: '12px 14px',
        background: '#fff'
      }}
    >
      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: color || '#1e293b' }}>{value}</div>
      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{label}</div>
    </div>
  )
}

function SummarySection({ title, children }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: '0.92rem',
          marginBottom: '8px',
          paddingBottom: '4px',
          borderBottom: '2px solid #e3e8ef'
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

const tileGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
  gap: '10px'
}

export function SummaryModal({
  equipment = [],
  actions = [],
  inspections = [],
  technicians = [],
  stock = [],
  expiring = [],
  completed = [],
  onClose
}) {
  const now = new Date()
  const active = equipment.filter((e) => e.current_status !== 'no_longer_in_service')
  const functional = active.filter((e) => e.current_status === 'functional').length
  const needsAttention = active.length - functional
  const retired = equipment.length - active.length

  const byType = Object.keys(TYPE_LABELS).map((type) => {
    const items = active.filter((e) => e.equipment_type === type)
    const ok = items.filter((e) => e.current_status === 'functional').length
    return { type, total: items.length, ok, bad: items.length - ok }
  })

  const pending = actions.filter((a) => a.status === 'pending').length
  const inProgress = actions.filter((a) => a.status === 'in_progress').length
  const unresolved = actions.filter((a) => a.status === 'unresolved').length
  const awaitingVerify = actions.filter(
    (a) => a.status === 'in_progress' && a.repair_status === 'repaired'
  ).length
  const prio = (p) => actions.filter((a) => a.priority === p).length

  const insToday = inspections.filter((i) => sameDay(new Date(i.inspection_date), now)).length
  const insWeek = inspections.filter(
    (i) => now - new Date(i.inspection_date) <= 7 * 24 * 60 * 60 * 1000
  ).length
  const insDefects = inspections.filter((i) => i.condition_status === 'defective').length

  const availableTechs = technicians.filter((t) => t.is_available).length
  const busyTechIds = new Set(
    actions.filter((a) => a.status === 'in_progress' && a.assigned_technician_id).map((a) => a.assigned_technician_id)
  )

  const expiredCount = expiring.filter((e) => e.daysLeft < 0).length
  const soonCount = expiring.length - expiredCount

  const doneToday = completed.filter(
    (a) => a.completed_date && sameDay(new Date(a.completed_date), now)
  ).length
  const doneWeek = completed.filter(
    (a) => a.completed_date && now - new Date(a.completed_date) <= 7 * 24 * 60 * 60 * 1000
  ).length

  const th = { textAlign: 'left', fontSize: '0.78rem', color: '#64748b', padding: '6px 8px', borderBottom: '1px solid #e3e8ef' }
  const td = { fontSize: '0.86rem', padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }

  return (
    <div className="modal-overlay">
      <div
        className="modal-box"
        style={{ maxWidth: '820px', width: '94vw', maxHeight: '90vh', overflowY: 'auto', textAlign: 'left' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <div className="modal-title" style={{ marginBottom: '2px' }}>System Summary</div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '16px' }}>
              NBSC Fire Safety Equipment System · generated {fmtDateTime(now)}
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <SummarySection title="Equipment overview">
          <div style={tileGrid}>
            <Tile label="Active equipment" value={active.length} />
            <Tile label="Functional" value={functional} color="#15803d" />
            <Tile label="Needs attention" value={needsAttention} color={needsAttention ? '#b91c1c' : undefined} />
            <Tile label="Retired" value={retired} />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px' }}>
            <thead>
              <tr>
                <th style={th}>Type</th>
                <th style={th}>Total</th>
                <th style={th}>Functional</th>
                <th style={th}>Needs attention</th>
              </tr>
            </thead>
            <tbody>
              {byType.map((r) => (
                <tr key={r.type}>
                  <td style={td}>{TYPE_LABELS[r.type]}</td>
                  <td style={td}>{r.total}</td>
                  <td style={{ ...td, color: '#15803d', fontWeight: 600 }}>{r.ok}</td>
                  <td style={{ ...td, color: r.bad ? '#b91c1c' : undefined, fontWeight: r.bad ? 600 : 400 }}>{r.bad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SummarySection>

        <SummarySection title="Priority actions">
          <div style={tileGrid}>
            <Tile label="Open actions" value={actions.length} />
            <Tile label="Needs Job Order" value={pending} color={pending ? '#b45309' : undefined} />
            <Tile label="In progress" value={inProgress} color="#2563eb" />
            <Tile label="Awaiting your verification" value={awaitingVerify} color={awaitingVerify ? '#15803d' : undefined} />
            <Tile label="Unresolved" value={unresolved} color={unresolved ? '#b91c1c' : undefined} />
          </div>
          <div style={{ fontSize: '0.84rem', color: '#64748b', marginTop: '10px' }}>
            By priority — Critical: <strong>{prio('critical')}</strong> · High: <strong>{prio('high')}</strong> ·
            Medium: <strong>{prio('medium')}</strong> · Low: <strong>{prio('low')}</strong>
          </div>
        </SummarySection>

        <SummarySection title="Completed repairs">
          <div style={tileGrid}>
            <Tile label="Total completed" value={completed.length} color="#15803d" />
            <Tile label="Today" value={doneToday} />
            <Tile label="Last 7 days" value={doneWeek} />
          </div>
          {completed.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px' }}>
              <thead>
                <tr>
                  <th style={th}>Equipment</th>
                  <th style={th}>Work</th>
                  <th style={th}>Completed by</th>
                  <th style={th}>When</th>
                </tr>
              </thead>
              <tbody>
                {completed.slice(0, 8).map((a) => (
                  <tr key={a.id}>
                    <td style={td}>
                      {a.equipment?.equipment_code} — {TYPE_LABELS[a.equipment?.equipment_type] || ''}
                    </td>
                    <td style={td}>{a.description}</td>
                    <td style={td}>{a.completed_by || '—'}</td>
                    <td style={td}>{ago(a.completed_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SummarySection>

        <SummarySection title="Inspections">
          <div style={tileGrid}>
            <Tile label="Total recorded" value={inspections.length} />
            <Tile label="Today" value={insToday} />
            <Tile label="Last 7 days" value={insWeek} />
            <Tile label="Defects found (all time)" value={insDefects} color={insDefects ? '#b91c1c' : undefined} />
          </div>
        </SummarySection>

        <SummarySection title="Expiration">
          <div style={tileGrid}>
            <Tile label="Expired" value={expiredCount} color={expiredCount ? '#b91c1c' : undefined} />
            <Tile label="Expiring within 30 days" value={soonCount} color={soonCount ? '#b45309' : undefined} />
          </div>
        </SummarySection>

        <SummarySection title="Technicians">
          <div style={tileGrid}>
            <Tile label="Registered" value={technicians.length} />
            <Tile label="Available" value={availableTechs} color="#15803d" />
            <Tile label="With a job in progress" value={busyTechIds.size} color="#2563eb" />
          </div>
        </SummarySection>

        <SummarySection title="Stock on hand">
          <div style={tileGrid}>
            {Object.keys(TYPE_LABELS).map((type) => {
              const s = stock.find((x) => x.equipment_type === type)
              const qty = s ? s.quantity_available : 0
              return (
                <Tile key={type} label={TYPE_LABELS[type]} value={qty} color={qty === 0 ? '#b91c1c' : undefined} />
              )
            })}
          </div>
        </SummarySection>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Inspectors tab                                                      */
/* ------------------------------------------------------------------ */

// inspections.inspector_name may be stored as "Name" or "Name (inspector)".
function cleanName(name) {
  return (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim()
}

export function InspectorsTab({ inspections = [], equipment = [] }) {
  const [profiles, setProfiles] = useState([])
  const [expandedKey, setExpandedKey] = useState(null)

  // Inspector accounts live in the profiles table. If the database rules do
  // not let the admin read other profiles, this just stays empty and the
  // list is built from submitted inspections only.
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('role', 'inspector')
      .then(({ data, error }) => {
        if (!error && data) setProfiles(data)
      })
  }, [])

  const codeById = useMemo(() => {
    const m = {}
    equipment.forEach((e) => {
      m[e.id] = e.equipment_code
    })
    return m
  }, [equipment])

  const rows = useMemo(() => {
    const map = {}
    profiles.forEach((p) => {
      const name = cleanName(p.full_name)
      if (name) map[name.toLowerCase()] = { name, hasAccount: true, items: [] }
    })
    inspections.forEach((i) => {
      const name = cleanName(i.inspector_name) || 'Not recorded'
      const key = name.toLowerCase()
      if (!map[key]) map[key] = { name, hasAccount: false, items: [] }
      map[key].items.push(i)
    })
    const now = new Date()
    return Object.entries(map)
      .map(([key, r]) => {
        const items = [...r.items].sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date))
        return {
          key,
          name: r.name,
          hasAccount: r.hasAccount,
          items,
          total: items.length,
          defects: items.filter((i) => i.condition_status === 'defective').length,
          today: items.filter((i) => sameDay(new Date(i.inspection_date), now)).length,
          week: items.filter((i) => now - new Date(i.inspection_date) <= 7 * 24 * 60 * 60 * 1000).length,
          last: items[0]?.inspection_date || null
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [profiles, inspections])

  return (
    <div>
      <div className="section-heading">
        <h2>Inspectors</h2>
        <span className="count-pill">{rows.length} listed</span>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No inspectors or inspections recorded yet.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '14px',
            marginBottom: '18px'
          }}
        >
          {rows.map((r) => (
            <div key={r.key} className="panel" style={{ margin: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                {r.name}
                {r.hasAccount && (
                  <span style={{ marginLeft: '8px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--blue)' }}>
                    📱 App account
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {r.last ? `Last inspection ${ago(r.last)}` : 'No inspections submitted yet'}
              </div>

              <div style={{ display: 'flex', gap: '18px', marginTop: '12px' }}>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{r.today}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Today</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{r.week}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>This week</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{r.total}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Total</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: r.defects ? 'var(--red)' : undefined }}>
                    {r.defects}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Defects found</div>
                </div>
              </div>

              <div className="equipment-actions" style={{ marginTop: '12px' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setExpandedKey(expandedKey === r.key ? null : r.key)}
                  disabled={r.total === 0}
                >
                  {expandedKey === r.key ? 'Hide inspections' : `View inspections (${r.total})`}
                </button>
              </div>

              {expandedKey === r.key && (
                <div style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
                  {r.items.slice(0, 15).map((i) => {
                    const failed = i.condition_status === 'defective'
                    return (
                      <div
                        key={i.id}
                        style={{
                          borderLeft: `3px solid ${failed ? 'var(--red)' : 'var(--green)'}`,
                          paddingLeft: '10px',
                          marginBottom: '8px'
                        }}
                      >
                        <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                          {codeById[i.equipment_id] || 'Equipment'} — {failed ? '⚠ Defective' : '✓ Functional'}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                          {fmtDateTime(i.inspection_date)}
                        </span>
                        {i.findings && (
                          <p style={{ fontSize: '0.82rem', margin: '2px 0 0 0' }}>{i.findings}</p>
                        )}
                      </div>
                    )
                  })}
                  {r.items.length > 15 && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                      Showing the latest 15 of {r.items.length}.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Job Order Request form                                              */
/* ------------------------------------------------------------------ */

function FormCell({ label, children, span }) {
  return (
    <div
      style={{
        background: '#fff',
        padding: '6px 10px',
        gridColumn: span ? `span ${span}` : undefined
      }}
    >
      <div
        style={{
          fontSize: '0.66rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#64748b',
          marginBottom: '2px'
        }}
      >
        {label}
      </div>
      <div style={{ fontWeight: 600, fontSize: '0.88rem', lineHeight: 1.4 }}>{children}</div>
    </div>
  )
}

function FormBand({ children }) {
  return (
    <div
      style={{
        background: '#0f2a4a',
        color: '#fff',
        fontSize: '0.74rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        padding: '5px 10px',
        marginTop: '12px'
      }}
    >
      {children}
    </div>
  )
}

const formGrid = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '1px',
  background: '#cbd5e1',
  border: '1px solid #cbd5e1'
}

export function JobOrderRequestModal({
  modal,
  profile,
  technicians,
  fireExtinguisherStock,
  selectedTechnicianId,
  onSelectTechnician,
  remarks,
  onRemarksChange,
  onCancel,
  onSubmit
}) {
  const isReassign = !!modal.isReassign

  const technicianSelect = (
    <>
      <select value={selectedTechnicianId} onChange={(e) => onSelectTechnician(e.target.value)}>
        <option value="">-- Select technician --</option>
        {technicians.map((t) => (
          <option key={t.id} value={t.id}>
            {t.full_name} {t.is_available ? '(Available)' : '(Unavailable)'} {t.profile_id ? '· 📱 app' : ''}
          </option>
        ))}
      </select>
      {technicians.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--amber)', margin: '6px 0 0 0' }}>
          No technicians listed yet. Add one in the Technicians tab first.
        </p>
      )}
    </>
  )

  if (isReassign) {
    return (
      <div className="modal-overlay">
        <div className="modal-box" style={{ maxWidth: '460px' }}>
          <div className="modal-title">Reassign Technician</div>
          <div style={{ marginBottom: '14px' }}>
            <label className="field-label">Assign Technician</label>
            {technicianSelect}
          </div>
          <div className="modal-actions" style={{ gap: '8px' }}>
            <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            <button className="btn btn-primary" onClick={onSubmit}>Save Assignment</button>
          </div>
        </div>
      </div>
    )
  }

  const joNumber = `JO-${new Date().getFullYear()}-${String(modal.actionId).replace(/-/g, '').slice(0, 5).toUpperCase()}`
  const selectedTech = technicians.find((t) => t.id === selectedTechnicianId)

  return (
    <div className="modal-overlay">
      <div
        className="modal-box"
        style={{ maxWidth: '700px', width: '94vw', maxHeight: '92vh', overflowY: 'auto', textAlign: 'left' }}
      >
        {/* Letterhead */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid #0f2a4a', paddingBottom: '10px' }}>
          <div style={{ fontSize: '0.72rem', letterSpacing: '0.08em', color: '#475569' }}>
            NORTHERN BUKIDNON STATE COLLEGE
          </div>
          <div style={{ fontSize: '0.78rem', color: '#475569' }}>General Services Office</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: '4px', letterSpacing: '0.04em' }}>
            JOB ORDER REQUEST
          </div>
        </div>

        <FormBand>I. Request details</FormBand>
        <div style={formGrid}>
          <FormCell label="Job Order No.">{joNumber}</FormCell>
          <FormCell label="Date requested">{fmtDateTime(new Date())}</FormCell>
          <FormCell label="Requested by">
            {profile.full_name} ({profile.role})
          </FormCell>
          <FormCell label="Status">Pending submission</FormCell>
        </div>

        <FormBand>II. Equipment concerned</FormBand>
        <div style={formGrid}>
          <FormCell label="Equipment code">{modal.equipmentCode}</FormCell>
          <FormCell label="Equipment type">
            {TYPE_LABELS[modal.equipmentType] || modal.equipmentType}
          </FormCell>
          <FormCell label="Location (building / floor / room)" span={2}>
            {modal.location}
          </FormCell>
          {modal.isFireExtinguisher && (
            <FormCell label="Replacement stock on hand" span={2}>
              {fireExtinguisherStock} fire extinguisher{fireExtinguisherStock === 1 ? '' : 's'} available
            </FormCell>
          )}
        </div>

        <FormBand>III. Work requested</FormBand>
        <div style={formGrid}>
          <FormCell label="Nature of work">
            {ACTION_TYPE_LABELS[modal.actionType] || modal.actionType}
          </FormCell>
          <FormCell label="Priority">
            <span style={{ textTransform: 'capitalize' }}>{modal.priority}</span>
          </FormCell>
          <FormCell label="Reported defect / description of work" span={2}>
            {modal.finding}
          </FormCell>
          <FormCell label="Date defect reported" span={2}>
            {fmtDateTime(modal.reportedDate)}
          </FormCell>
        </div>

        <div style={{ marginTop: '12px' }}>
          <label className="field-label">Remarks / special instructions (optional)</label>
          <textarea
            rows={3}
            placeholder="e.g. Check the alarm wiring in the corridor first"
            value={remarks}
            onChange={(e) => onRemarksChange(e.target.value)}
          />
        </div>

        <FormBand>IV. Assigned technician</FormBand>
        <div style={{ border: '1px solid #cbd5e1', borderTop: 'none', padding: '10px' }}>
          {technicianSelect}
        </div>

        {/* Signatures */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '18px',
            marginTop: '26px'
          }}
        >
          {[
            { name: profile.full_name, caption: 'Requested by' },
            { name: '', caption: 'Noted by (GSO Head)' },
            { name: selectedTech?.full_name || '', caption: 'Received by (Technician)' }
          ].map((sig) => (
            <div key={sig.caption} style={{ textAlign: 'center' }}>
              <div
                style={{
                  borderBottom: '1px solid #1e293b',
                  minHeight: '24px',
                  fontSize: '0.84rem',
                  fontWeight: 600
                }}
              >
                {sig.name}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '3px' }}>{sig.caption}</div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '16px 0 0 0' }}>
          Form layout is provisional and will be matched to the official GSO Job Order form once the
          template is provided.
        </p>

        <div className="modal-actions" style={{ gap: '8px', marginTop: '14px' }}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={onSubmit}>Submit Job Order</button>
        </div>
      </div>
    </div>
  )
}