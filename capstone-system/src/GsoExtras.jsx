import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { playNotificationSound } from './gsoNotifications'
import { accountErrorMessage, checkAccountFields, checkUsername, USERNAME_HINT } from './staffAccounts'

/* =====================================================================
   Exports:
     NotificationBell        bell button + dropdown + sound and pop-ups
     PriorityActionsSummary  Job Order / Purchase Request summary ("All" view)
     SummaryModal            the "Summary" view
     InspectorsTab           the Inspectors sidebar page
     JobOrderRequestModal    the Job Order Request form

   The notification list itself is built in gsoNotifications.js.
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
  // A date with no time (YYYY-MM-DD) shows the date only, not a made-up time.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d))
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
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
/* Password field with a show / hide button (same as the login page)   */
/* ------------------------------------------------------------------ */

export function PasswordInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="password-field-wrap">
      <input
        type={show ? 'text' : 'password'}
        autoComplete="new-password"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        className="password-toggle-btn"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide password' : 'Show password'}
      >
        {show ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}

const hintStyle = { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '5px 0 0 0' }

// Outline bell (no fill), drawn in the surrounding text colour.
function BellIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d="M10.5 3.2a1.5 1.5 0 0 1 3 0" />
      <path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15.5 6 9" />
      <path d="M9.8 20.5a2.4 2.4 0 0 0 4.4 0" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Account settings: change a staff login's username / password        */
/* ------------------------------------------------------------------ */

// `account`: { id, full_name, username }. The current password is never
// shown (it is stored encrypted); a forgotten one is replaced.
export function AccountSettingsModal({ account, onClose, onSaved }) {
  const [username, setUsername] = useState(account.username || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setError(null)
    const problem = checkUsername(username)
    if (problem) {
      setError(problem)
      return
    }
    if (password && password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setSaving(true)
    const { data, error: rpcError } = await supabase.rpc('update_staff_account', {
      p_user_id: account.id,
      p_username: username.trim(),
      p_password: password || null
    })
    setSaving(false)
    if (rpcError) {
      setError(accountErrorMessage(rpcError))
      return
    }
    onSaved(
      `Account updated for ${account.full_name}. Username: "${data?.username}"` +
        (data?.password_changed ? ' · new password set.' : '.')
    )
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '460px', textAlign: 'left' }}>
        <div className="modal-title">Account settings</div>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '0 0 14px 0' }}>
          Mobile app login for <strong>{account.full_name}</strong>.
        </p>

        <div style={{ marginBottom: '12px' }}>
          <label className="field-label">Username</label>
          <input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
          <p style={hintStyle}>{USERNAME_HINT}</p>
        </div>

        <div style={{ marginBottom: '6px' }}>
          <label className="field-label">New password</label>
          <PasswordInput
            placeholder="Leave blank to keep the current password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p style={hintStyle}>
            For security, the current password can't be shown. If they forgot it, type a new one
            (at least 6 characters) and tell them.
          </p>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions" style={{ gap: '8px', marginTop: '14px' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

const TONE = {
  red: { bar: '#dc2626', bg: '#fef2f2' },
  amber: { bar: '#d97706', bg: '#fffbeb' },
  green: { bar: '#16a34a', bg: '#f0fdf4' },
  blue: { bar: '#2563eb', bg: '#eff6ff' }
}

// Read/unread and the sound setting are saved per account, so two admins
// sharing one computer each keep their own. (Before, they were saved per
// browser, so one admin marking something read hid it from the other.)
const LEGACY_SEEN_KEY = 'gso-seen-notifications'
const seenKey = (accountId) => `gso-seen-notifications-${accountId}`
const soundKey = (accountId) => `gso-notification-sound-${accountId}`
const TOAST_MS = 7000

function loadSeen(accountId) {
  try {
    // First time on this account: carry over the old shared list once.
    const raw = localStorage.getItem(seenKey(accountId)) ?? localStorage.getItem(LEGACY_SEEN_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveSeen(accountId, list) {
  try {
    localStorage.setItem(seenKey(accountId), JSON.stringify(list.slice(-500)))
  } catch {
    /* storage unavailable — read state just won't persist */
  }
}

function loadSoundOn(accountId) {
  try {
    return localStorage.getItem(soundKey(accountId)) !== 'off'
  } catch {
    return true
  }
}

function desktopSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

// `ready` is false until the dashboard's first load has finished, so the
// notifications that already existed when the page opened don't all ding
// at once. After that, every NEW unread notification plays the sound and
// pops up in the corner (like Facebook), and — when this tab is in the
// background — also shows as a desktop notification.
export function NotificationBell({ accountId, notifications, onNavigate, ready = true }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => loadSeen(accountId))
  const [soundOn, setSoundOn] = useState(() => loadSoundOn(accountId))
  const [toasts, setToasts] = useState([])
  const [desktopPermission, setDesktopPermission] = useState(
    desktopSupported() ? Notification.permission : 'unsupported'
  )
  const knownIdsRef = useRef(null)

  const seenSet = useMemo(() => new Set(seen), [seen])
  const unread = notifications.filter((n) => !seenSet.has(n.id)).length

  const soundOnRef = useRef(soundOn)
  const onNavigateRef = useRef(onNavigate)
  useEffect(() => {
    soundOnRef.current = soundOn
    onNavigateRef.current = onNavigate
  })

  useEffect(() => {
    if (!ready) return
    if (knownIdsRef.current === null) {
      knownIdsRef.current = new Set(notifications.map((n) => n.id))
      return
    }
    const fresh = notifications.filter(
      (n) => !knownIdsRef.current.has(n.id) && !seenSet.has(n.id)
    )
    notifications.forEach((n) => knownIdsRef.current.add(n.id))
    if (fresh.length === 0) return

    if (soundOnRef.current) playNotificationSound()
    setToasts((prev) => [...fresh.slice(0, 3), ...prev].slice(0, 4))

    if (
      desktopSupported() &&
      Notification.permission === 'granted' &&
      document.visibilityState === 'hidden'
    ) {
      fresh.slice(0, 3).forEach((n) => {
        try {
          const d = new Notification(n.title, { body: n.detail, tag: n.id })
          d.onclick = () => {
            window.focus()
            onNavigateRef.current && onNavigateRef.current(n)
            d.close()
          }
        } catch {
          /* some browsers only allow this from a service worker */
        }
      })
    }
  }, [notifications, ready, seenSet])

  // Each popup closes by itself after a few seconds.
  useEffect(() => {
    if (toasts.length === 0) return
    const timer = setTimeout(() => setToasts((prev) => prev.slice(0, -1)), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toasts])

  function markSeen(id) {
    if (seenSet.has(id)) return
    const next = [...seen, id]
    setSeen(next)
    saveSeen(accountId, next)
  }

  function markAll() {
    const next = [...new Set([...seen, ...notifications.map((n) => n.id)])]
    setSeen(next)
    saveSeen(accountId, next)
  }

  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    try {
      localStorage.setItem(soundKey(accountId), next ? 'on' : 'off')
    } catch {
      /* ignore */
    }
    if (next) playNotificationSound()
  }

  function enableDesktop() {
    if (!desktopSupported()) return
    Notification.requestPermission().then(setDesktopPermission).catch(() => {})
  }

  function openItem(n) {
    markSeen(n.id)
    setOpen(false)
    setToasts((prev) => prev.filter((t) => t.id !== n.id))
    onNavigate && onNavigate(n)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="logout-btn"
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label="Notifications"
        style={{ position: 'relative', marginRight: '6px', display: 'inline-flex', alignItems: 'center' }}
      >
        <BellIcon size={18} />
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
                padding: '12px 14px',
                borderBottom: '1px solid #e3e8ef',
                position: 'sticky',
                top: 0,
                background: '#fff',
                zIndex: 1
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.95rem' }}>Notifications</strong>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={markAll}
                  disabled={unread === 0}
                >
                  Mark all as read
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={toggleSound}>
                  {soundOn ? '🔊 Sound on' : '🔇 Sound off'}
                </button>
                {desktopPermission === 'default' && (
                  <button className="btn btn-secondary btn-sm" onClick={enableDesktop}>
                    Enable desktop alerts
                  </button>
                )}
                {desktopPermission === 'denied' && (
                  <span style={{ fontSize: '0.74rem', color: '#64748b', alignSelf: 'center' }}>
                    Desktop alerts are blocked in this browser&apos;s settings.
                  </span>
                )}
              </div>
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
                    onClick={() => openItem(n)}
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

      {/* Pop-up notifications, bottom-left corner */}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            left: '18px',
            bottom: '18px',
            display: 'flex',
            flexDirection: 'column-reverse',
            gap: '10px',
            zIndex: 2000,
            width: '340px',
            maxWidth: 'calc(100vw - 36px)',
            textAlign: 'left'
          }}
        >
          {toasts.map((n) => {
            const tone = TONE[n.tone] || TONE.blue
            return (
              <div
                key={n.id}
                className="gso-toast"
                role="status"
                onClick={() => openItem(n)}
                style={{
                  cursor: 'pointer',
                  background: '#fff',
                  color: '#1e293b',
                  border: '1px solid #e3e8ef',
                  borderLeft: `5px solid ${tone.bar}`,
                  borderRadius: '12px',
                  boxShadow: '0 10px 28px rgba(15,42,74,0.28)',
                  padding: '12px 14px',
                  display: 'flex',
                  gap: '10px'
                }}
              >
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '50%',
                    background: tone.bg,
                    color: tone.bar,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: '1rem'
                  }}
                >
                  <BellIcon size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{n.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                    {n.detail}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#2563eb', marginTop: '4px', fontWeight: 600 }}>
                    Click to open
                  </div>
                </div>
                <button
                  aria-label="Dismiss"
                  onClick={(e) => {
                    e.stopPropagation()
                    setToasts((prev) => prev.filter((t) => t.id !== n.id))
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    alignSelf: 'flex-start',
                    padding: 0
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Priority Actions — "All" view summary                               */
/* ------------------------------------------------------------------ */

const PRIORITY_TAG = {
  critical: { bg: '#fef2f2', fg: '#b91c1c' },
  high: { bg: '#fff1e6', fg: '#c2410c' },
  medium: { bg: '#fffbeb', fg: '#b45309' },
  low: { bg: '#eff6ff', fg: '#2563eb' }
}

const PR_STATUS_LABELS = {
  pending: 'Needs Job Order',
  in_progress: 'Job Order in progress',
  unresolved: 'Unresolved',
  delayed: 'Delayed',
  for_disposal: 'For disposal',
  expired: 'Expired — no job yet'
}

function SmallTag({ children, bg, fg }) {
  return (
    <span
      style={{
        display: 'inline-block',
        background: bg,
        color: fg,
        fontSize: '0.7rem',
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
        textTransform: 'capitalize'
      }}
    >
      {children}
    </span>
  )
}

function SummaryColumn({ title, hint, count, accent, children }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderTop: `4px solid ${accent}`,
        borderRadius: '10px',
        background: '#fff',
        padding: '14px 16px',
        minWidth: 0
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ fontWeight: 700, fontSize: '0.98rem' }}>{title}</div>
        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: count ? accent : 'var(--text-muted)' }}>
          {count}
        </span>
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 10px 0' }}>{hint}</div>
      {children}
    </div>
  )
}

function SummaryRow({ onClick, title, tag, lines }) {
  return (
    <div
      onClick={onClick}
      title="Click to open"
      style={{
        cursor: onClick ? 'pointer' : 'default',
        padding: '9px 0',
        borderTop: '1px solid #eef1f5'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{title}</span>
        {tag}
      </div>
      {lines.filter(Boolean).map((l, i) => (
        <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
          {l}
        </div>
      ))}
    </div>
  )
}

// Shown at the top of Priority Actions when the filter is "All". It gathers,
// in one place, every unit that needs a Job Order Request and every unit
// that needs a Purchase Request. Clicking a row opens it in its own filter,
// where the action buttons are.
export function PriorityActionsSummary({ jobOrderActions = [], purchaseItems = [], onOpenAction, onOpenExpiry }) {
  const qtyByType = {}
  purchaseItems.forEach((p) => {
    qtyByType[p.type] = (qtyByType[p.type] || 0) + 1
  })

  return (
    <div
      className="panel"
      style={{ marginBottom: '18px', background: 'var(--gray-bg, #f8fafc)' }}
    >
      <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '2px' }}>Summary of required requests</div>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '14px' }}>
        All equipment that needs a Job Order Request or a Purchase Request, gathered in one place.
        Click an item to open it.
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '14px'
        }}
      >
        <SummaryColumn
          title="Needs Job Order Request"
          hint="Reported defects with no technician assigned yet."
          count={jobOrderActions.length}
          accent="#d97706"
        >
          {jobOrderActions.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--green)' }}>✓ None — every defect has a Job Order.</div>
          ) : (
            jobOrderActions.map((a) => {
              const p = PRIORITY_TAG[a.priority] || PRIORITY_TAG.medium
              return (
                <SummaryRow
                  key={a.id}
                  onClick={() => onOpenAction(a)}
                  title={`${a.equipment?.equipment_code ?? '—'} — ${TYPE_LABELS[a.equipment?.equipment_type] || a.equipment?.equipment_type || ''}`}
                  tag={<SmallTag bg={p.bg} fg={p.fg}>{a.priority}</SmallTag>}
                  lines={[
                    `${a.equipment?.buildings?.building_name ?? 'N/A'} — ${a.equipment?.exact_location ?? ''}`,
                    a.description,
                    `Reported ${fmtDateTime(a.reported_date)}`
                  ]}
                />
              )
            })
          )}
        </SummaryColumn>

        <SummaryColumn
          title="Needs Purchase Request"
          hint="Units that need a replacement, with no stock on hand to cover them."
          count={purchaseItems.length}
          accent="#b91c1c"
        >
          {purchaseItems.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--green)' }}>✓ None — stock covers every replacement.</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                {Object.entries(qtyByType).map(([type, qty]) => (
                  <SmallTag key={type} bg="#fef2f2" fg="#b91c1c">
                    {TYPE_LABELS[type] || type} × {qty}
                  </SmallTag>
                ))}
              </div>
              {purchaseItems.map((p) => (
                <SummaryRow
                  key={p.key}
                  onClick={() => (p.actionId ? onOpenAction({ id: p.actionId, status: p.status }) : onOpenExpiry())}
                  title={`${p.code ?? '—'} — ${TYPE_LABELS[p.type] || p.type || ''}`}
                  tag={<SmallTag bg="#f1f5f9" fg="#475569">{PR_STATUS_LABELS[p.status] || p.status}</SmallTag>}
                  lines={[
                    `${p.building ?? 'N/A'} — ${p.location ?? ''}`,
                    p.reason,
                    `Stock on hand: ${p.stockOnHand}`
                  ]}
                />
              ))}
            </>
          )}
        </SummaryColumn>
      </div>
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
  purchaseItems = [],
  types = [],
  onClose
}) {
  const now = new Date()
  const active = equipment.filter((e) => e.current_status !== 'no_longer_in_service')
  const functional = active.filter((e) => e.current_status === 'functional').length
  const needsAttention = active.length - functional
  const retired = equipment.length - active.length
  // Built-in types plus any added through "Others".
  const typeList = types.length ? types : Object.keys(TYPE_LABELS)

  const byType = typeList.map((type) => {
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

  // Prints this window as a summary report. While printing, the page's
  // print stylesheet shows only this window (see .printing-summary in
  // index.css) and hides its buttons.
  function printSummary() {
    document.body.classList.add('printing-summary')
    const done = () => {
      document.body.classList.remove('printing-summary')
      window.removeEventListener('afterprint', done)
    }
    window.addEventListener('afterprint', done)
    setTimeout(() => {
      window.print()
      done()
    }, 100)
  }

  return (
    <div className="modal-overlay summary-print-overlay">
      <div
        className="modal-box summary-print-box"
        style={{ maxWidth: '820px', width: '94vw', maxHeight: '90vh', overflowY: 'auto', textAlign: 'left' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <div className="modal-title" style={{ marginBottom: '2px' }}>System Summary</div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '16px' }}>
              NBSC Fire Safety Equipment System · generated {fmtDateTime(now)}
            </div>
          </div>
          <div className="no-print" style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary btn-sm" onClick={printSummary}>🖨 Print Summary</button>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
          </div>
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
                  <td style={td}>{TYPE_LABELS[r.type] || r.type}</td>
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

        <SummarySection title="Requests needed">
          <div style={tileGrid}>
            <Tile label="Needs Job Order Request" value={pending} color={pending ? '#b45309' : undefined} />
            <Tile label="Needs Purchase Request" value={purchaseItems.length} color={purchaseItems.length ? '#b91c1c' : undefined} />
          </div>
          {purchaseItems.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px' }}>
              <thead>
                <tr>
                  <th style={th}>Equipment (Purchase Request)</th>
                  <th style={th}>Location</th>
                  <th style={th}>Reason</th>
                  <th style={th}>Stock on hand</th>
                </tr>
              </thead>
              <tbody>
                {purchaseItems.map((p) => (
                  <tr key={p.key}>
                    <td style={td}>{p.code} — {TYPE_LABELS[p.type] || p.type}</td>
                    <td style={td}>{p.building ?? 'N/A'} — {p.location ?? ''}</td>
                    <td style={td}>{p.reason}</td>
                    <td style={{ ...td, color: '#b91c1c', fontWeight: 600 }}>{p.stockOnHand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
                    <td style={td}>{fmtDateTime(a.completed_date)}</td>
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
            {typeList.map((type) => {
              const s = stock.find((x) => x.equipment_type === type)
              const qty = s ? s.quantity_available : 0
              return (
                <Tile key={type} label={TYPE_LABELS[type] || type} value={qty} color={qty === 0 ? '#b91c1c' : undefined} />
              )
            })}
          </div>
        </SummarySection>

        <div className="modal-actions no-print">
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
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', username: '', password: '' })
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  // Which inspector's Account settings window is open
  const [settingsFor, setSettingsFor] = useState(null)

  // Inspector accounts, with their usernames (migration 005). Before 005,
  // fall back to reading profiles directly; if the database rules don't
  // allow that either, the list is built from submitted inspections only.
  async function fetchInspectors() {
    const { data, error } = await supabase.rpc('list_staff_accounts')
    if (!error) return (data || []).filter((a) => a.role === 'inspector')
    const fallback = await supabase.from('profiles').select('id, full_name, role').eq('role', 'inspector')
    return !fallback.error && fallback.data ? fallback.data : []
  }

  useEffect(() => {
    fetchInspectors().then(setProfiles)
  }, [])

  // Creates the inspector's mobile app login (username + password).
  async function handleAddInspector(e) {
    e.preventDefault()
    setFormError(null)
    if (!form.full_name.trim()) {
      setFormError('Full name is required.')
      return
    }
    const problem = checkAccountFields(form.username, form.password)
    if (problem) {
      setFormError(problem)
      return
    }
    setSaving(true)
    const { data, error } = await supabase.rpc('create_staff_account', {
      p_role: 'inspector',
      p_full_name: form.full_name.trim(),
      p_username: form.username.trim(),
      p_password: form.password
    })
    setSaving(false)
    if (error) {
      setFormError(accountErrorMessage(error))
      return
    }
    setNotice(
      `Inspector account created. ${form.full_name.trim()} can now sign in to the mobile app with username "${data?.username}".`
    )
    setForm({ full_name: '', username: '', password: '' })
    setShowForm(false)
    setProfiles(await fetchInspectors())
  }

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
      if (name) map[name.toLowerCase()] = { name, hasAccount: true, accountId: p.id, username: p.username || null, items: [] }
    })
    inspections.forEach((i) => {
      const name = cleanName(i.inspector_name) || 'Not recorded'
      const key = name.toLowerCase()
      if (!map[key]) map[key] = { name, hasAccount: false, accountId: null, username: null, items: [] }
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
          username: r.username,
          accountId: r.accountId,
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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="count-pill">{rows.length} listed</span>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Close' : '+ Add Inspector'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="panel">
          <form onSubmit={handleAddInspector} className="form-grid">
            <div>
              <label className="field-label">Full Name</label>
              <input
                placeholder="e.g. Maria Santos"
                value={form.full_name}
                onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label">Username (for the mobile app)</label>
              <input
                placeholder="e.g. mariasantos"
                autoComplete="off"
                value={form.username}
                onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              />
              <p style={hintStyle}>{USERNAME_HINT}</p>
            </div>
            <div>
              <label className="field-label">Password (at least 6 characters)</label>
              <PasswordInput
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>
            {formError && <p className="form-error">{formError}</p>}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating account...' : 'Add Inspector'}
            </button>
          </form>
        </div>
      )}

      {notice && (
        <div className="all-clear-banner" style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
          <span>✓ {notice}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setNotice(null)}>OK</button>
        </div>
      )}

      {settingsFor && (
        <AccountSettingsModal
          account={settingsFor}
          onClose={() => setSettingsFor(null)}
          onSaved={async (message) => {
            setSettingsFor(null)
            setNotice(message)
            setProfiles(await fetchInspectors())
          }}
        />
      )}

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
              {r.username && (
                <div style={{ fontSize: '0.82rem', marginTop: '2px' }}>
                  Username: <strong>{r.username}</strong>
                </div>
              )}
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

              <div className="equipment-actions" style={{ marginTop: '12px', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setExpandedKey(expandedKey === r.key ? null : r.key)}
                  disabled={r.total === 0}
                >
                  {expandedKey === r.key ? 'Hide inspections' : `View inspections (${r.total})`}
                </button>
                {r.accountId && r.username && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSettingsFor({ id: r.accountId, full_name: r.name, username: r.username })}
                  >
                    Account settings
                  </button>
                )}
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
              {fireExtinguisherStock === 0 && (
                <span style={{ color: '#b91c1c' }}> — no unit on hand, a Purchase Request is also needed</span>
              )}
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