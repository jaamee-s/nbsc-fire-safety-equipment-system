import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabaseClient'
import { needsReplacementUnit, playNotificationSound } from './gsoNotifications'
import { actionForInspection, inspectionPriority as priorityOfInspection, unitsForAssignment } from './reports'
import { accountErrorMessage, checkAccountFields, checkUsername, USERNAME_HINT } from './staffAccounts'
import nbscHeader from './assets/nbsc-print-header.png'
import JobOrderWindow from './JobOrderWindow'
import { JorEditorModal } from './OfficialFormEditors'
import {
  checkJobOrderDraft,
  formPrintUrl,
  formsErrorMessage,
  inspectionDescription,
  insertJobOrderForm,
  isJorNoTaken,
  jobOrderDraftForInspection
} from './officialForms'

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
  replace: 'Replace whole unit',
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
/* Edit account: a staff member's name, contact, username and password */
/* ------------------------------------------------------------------ */

// `account`: { id, full_name, username, contact? }. Contact is shown only
// when `contact` is given (technicians). The current password is never
// shown (it is stored encrypted); a forgotten one is replaced.
export function AccountSettingsModal({ account, onClose, onSaved }) {
  const hasContact = account.contact !== undefined
  const [fullName, setFullName] = useState(account.full_name || '')
  const [contact, setContact] = useState(account.contact || '')
  const [username, setUsername] = useState(account.username || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setError(null)
    if (!fullName.trim()) {
      setError('The name cannot be empty.')
      return
    }
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
      p_password: password || null,
      p_full_name: fullName.trim(),
      p_contact: hasContact ? contact.trim() : null
    })
    setSaving(false)
    if (rpcError) {
      setError(accountErrorMessage(rpcError))
      return
    }
    onSaved(
      `Account updated for ${data?.full_name || fullName.trim()}. Username: "${data?.username}"` +
        (data?.password_changed ? ' · new password set.' : '.')
    )
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '460px', textAlign: 'left' }}>
        <div className="modal-title">Edit account</div>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '0 0 14px 0' }}>
          Details and mobile app login for <strong>{account.full_name}</strong>.
        </p>

        <div style={{ marginBottom: '12px' }}>
          <label className="field-label">Full name</label>
          <input autoComplete="off" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>

        {hasContact && (
          <div style={{ marginBottom: '12px' }}>
            <label className="field-label">Contact info</label>
            <input
              autoComplete="off"
              placeholder="Phone number or other contact (optional)"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>
        )}

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

// Row tints come from the theme tokens, so unread rows stay readable in dark mode.
const TONE = {
  red: { bar: '#dc2626', bg: 'var(--red-bg)' },
  amber: { bar: '#d97706', bg: 'var(--amber-bg)' },
  green: { bar: '#16a34a', bg: 'var(--green-bg)' },
  blue: { bar: '#2563eb', bg: 'var(--blue-light)' }
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

// When each notification first reached this account ("arrived"). The bell
// shows and sorts by this, newest first. Before, it used the event's own
// date — e.g. the day a defect was reported — so a notification that came
// in today about a 24-day-old defect showed "24 days ago" and sat near the
// bottom of the list.
const arrivalsKey = (accountId) => `gso-notification-arrivals-${accountId}`

function loadArrivals(accountId) {
  try {
    const raw = localStorage.getItem(arrivalsKey(accountId))
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && parsed.times ? parsed : { syncedAt: null, times: {} }
  } catch {
    return { syncedAt: null, times: {} }
  }
}

function saveArrivals(accountId, arrivals) {
  try {
    localStorage.setItem(arrivalsKey(accountId), JSON.stringify(arrivals))
  } catch {
    /* storage unavailable — arrival times just won't persist */
  }
}

// Gives every notification not seen before its arrival time:
// - the event's own time when the event is newer than the last check (it
//   happened while the page was closed, or just now) — that is when it came in
// - "now" when the event is older than the last check (an old item that only
//   just appeared in the list, e.g. a job sent back to Needs Job Order)
// - the first time ever on this account, each one simply gets its event time
// Never later than now (an expiry date can be in the future).
function stampArrivals(arrivals, notifications) {
  const now = new Date().getTime()
  const times = {}
  let changed = false
  notifications.forEach((n) => {
    if (arrivals.times[n.id]) {
      times[n.id] = arrivals.times[n.id]
      return
    }
    changed = true
    const event = n.time ? new Date(n.time).getTime() : NaN
    let at
    if (!arrivals.syncedAt) at = Number.isNaN(event) ? now : Math.min(event, now)
    else if (!Number.isNaN(event) && event > arrivals.syncedAt) at = Math.min(event, now)
    else at = now
    times[n.id] = new Date(at).toISOString()
  })
  // Items no longer in the list are dropped, so the saved map stays small.
  if (Object.keys(arrivals.times).length !== Object.keys(times).length) changed = true
  // The "last check" time also moves forward at least once a minute while
  // the page is open, so an old item that reappears is stamped as arriving now.
  const stale = !arrivals.syncedAt || now - arrivals.syncedAt > 60 * 1000
  return changed || stale ? { syncedAt: now, times } : null
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
  const [arrivals, setArrivals] = useState(() => loadArrivals(accountId))
  // The notification list the arrival times were last updated for.
  const [stampedFor, setStampedFor] = useState(null)

  // Record when each notification arrived (see stampArrivals) whenever the
  // list changes. Waits for the dashboard's first load, so the list is
  // complete before anything is stamped. (Updating state while rendering,
  // the React-recommended way to follow a changed prop.)
  if (ready && stampedFor !== notifications) {
    setStampedFor(notifications)
    const next = stampArrivals(arrivals, notifications)
    if (next) setArrivals(next)
  }
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

  // Keep the arrival times on this computer, per account.
  useEffect(() => {
    if (arrivals.syncedAt) saveArrivals(accountId, arrivals)
  }, [arrivals, accountId])

  // Newest arrival first. Until a notification is stamped, its event time
  // stands in, so nothing jumps around on the first load.
  const sorted = useMemo(() => {
    const at = (n) => new Date(arrivals.times[n.id] || n.time || 0).getTime()
    return [...notifications]
      .map((n) => ({ ...n, arrivedAt: arrivals.times[n.id] || n.time || null }))
      .sort((a, b) => at(b) - at(a))
  }, [notifications, arrivals])

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
              background: 'var(--card)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              boxShadow: '0 12px 32px rgba(15,42,74,0.25)',
              zIndex: 999,
              textAlign: 'left'
            }}
          >
            <div
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid var(--border)',
                position: 'sticky',
                top: 0,
                background: 'var(--card)',
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
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                    Desktop alerts are blocked in this browser&apos;s settings.
                  </span>
                )}
              </div>
            </div>

            {notifications.length === 0 ? (
              <p style={{ padding: '18px 14px', margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                You&apos;re all caught up. Nothing needs your attention.
              </p>
            ) : (
              sorted.map((n) => {
                const isUnread = !seenSet.has(n.id)
                // The event's own date, when it differs from the arrival by
                // more than an hour (e.g. "Reported Oct 17, 2026, 11:33 PM").
                const showEvent =
                  n.time &&
                  n.arrivedAt &&
                  Math.abs(new Date(n.arrivedAt) - new Date(n.time)) > 60 * 60 * 1000
                const tone = TONE[n.tone] || TONE.blue
                return (
                  <div
                    key={n.id}
                    onClick={() => openItem(n)}
                    style={{
                      cursor: 'pointer',
                      padding: '11px 14px',
                      borderBottom: '1px solid var(--border)',
                      borderLeft: `4px solid ${tone.bar}`,
                      background: isUnread ? tone.bg : 'var(--card)'
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
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {n.detail}
                    </div>
                    <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
                      <strong>Next:</strong> {n.next}
                    </div>
                    {n.arrivedAt && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--chart-grey)', marginTop: '3px' }}>
                        {ago(n.arrivedAt)}
                        {showEvent &&
                          ` · ${n.timeLabel || 'Date'} ${/^\d{4}-\d{2}-\d{2}$/.test(String(n.time)) ? formatDay(n.time) : fmtDateTime(n.time)}`}
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
                  background: 'var(--card)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
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
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {n.detail}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--blue)', marginTop: '4px', fontWeight: 600 }}>
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
                    color: 'var(--chart-grey)',
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
  critical: { bg: 'var(--red-bg)', fg: 'var(--red)' },
  high: { bg: 'var(--orange-bg)', fg: 'var(--orange)' },
  medium: { bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  low: { bg: 'var(--blue-light)', fg: 'var(--blue)' }
}

const PR_STATUS_LABELS = {
  pending: 'Proceed to Purchase Request',
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
        background: 'var(--card)',
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

function SummaryRow({ onClick, title, tag, lines, actions }) {
  return (
    <div
      onClick={onClick}
      title="Click to open"
      style={{
        cursor: onClick ? 'pointer' : 'default',
        padding: '9px 0',
        borderTop: '1px solid var(--border)'
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
      {actions && (
        // Buttons here do their own thing, not "open the item".
        <div className="info-actions" style={{ marginTop: '8px' }} onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  )
}

// Shown at the top of Priority Actions when the filter is "All": every unit
// that needs a Purchase Request. (Job Orders are filed from the "Needs Job
// Order" filter, or from a technician's card — the adviser asked to drop the
// duplicate Job Order list here.) Clicking a row opens it.
// renderFormButtons(item): the Purchase Request form buttons for a row.
export function PriorityActionsSummary({ purchaseItems = [], onOpenAction, onOpenExpiry, renderFormButtons }) {
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
        All equipment that needs a Purchase Request, gathered in one place. Click an item to open it.
      </div>

      <div>
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
                  actions={renderFormButtons && p.equipmentId ? renderFormButtons(p) : null}
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
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '12px 14px',
        background: 'var(--card)'
      }}
    >
      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: color || 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{label}</div>
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
          borderBottom: '2px solid var(--border)'
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

  const th = { textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)', padding: '6px 8px', borderBottom: '1px solid var(--border)' }
  const td = { fontSize: '0.86rem', padding: '6px 8px', borderBottom: '1px solid var(--border)' }

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
        <img className="print-letterhead print-only" src={nbscHeader} alt="Northern Bukidnon State College" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <div className="modal-title" style={{ marginBottom: '2px' }}>System Summary</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
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
            <Tile label="Needs attention" value={needsAttention} color={needsAttention ? 'var(--red)' : undefined} />
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
                  <td style={{ ...td, color: 'var(--green)', fontWeight: 600 }}>{r.ok}</td>
                  <td style={{ ...td, color: r.bad ? 'var(--red)' : undefined, fontWeight: r.bad ? 600 : 400 }}>{r.bad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SummarySection>

        <SummarySection title="Priority actions">
          <div style={tileGrid}>
            <Tile label="Open actions" value={actions.length} />
            <Tile label="Needs Job Order" value={pending} color={pending ? 'var(--amber)' : undefined} />
            <Tile label="In progress" value={inProgress} color="#2563eb" />
            <Tile label="Awaiting your verification" value={awaitingVerify} color={awaitingVerify ? 'var(--green)' : undefined} />
            <Tile label="Unresolved" value={unresolved} color={unresolved ? 'var(--red)' : undefined} />
          </div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '10px' }}>
            By priority — Critical: <strong>{prio('critical')}</strong> · High: <strong>{prio('high')}</strong> ·
            Medium: <strong>{prio('medium')}</strong> · Low: <strong>{prio('low')}</strong>
          </div>
        </SummarySection>

        <SummarySection title="Requests needed">
          <div style={tileGrid}>
            <Tile label="Needs Job Order Request" value={pending} color={pending ? 'var(--amber)' : undefined} />
            <Tile label="Needs Purchase Request" value={purchaseItems.length} color={purchaseItems.length ? 'var(--red)' : undefined} />
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
                    <td style={{ ...td, color: 'var(--red)', fontWeight: 600 }}>{p.stockOnHand}</td>
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
            <Tile label="Defects found (all time)" value={insDefects} color={insDefects ? 'var(--red)' : undefined} />
          </div>
        </SummarySection>

        <SummarySection title="Expiration">
          <div style={tileGrid}>
            <Tile label="Expired" value={expiredCount} color={expiredCount ? 'var(--red)' : undefined} />
            <Tile label="Expiring within 30 days" value={soonCount} color={soonCount ? 'var(--amber)' : undefined} />
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
                <Tile key={type} label={TYPE_LABELS[type] || type} value={qty} color={qty === 0 ? 'var(--red)' : undefined} />
              )
            })}
          </div>
        </SummarySection>

        <div className="modal-actions no-print">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
        <ReportSignatures className="print-only" />
        {/* The print date: bottom left of every printed page */}
        <div className="print-footer-date print-only">Date printed: {fmtDateTime(now)}</div>
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

// Calendar day in the Philippines ('YYYY-MM-DD'), so "Today" means the same
// day here as in the mobile app, whatever this computer's clock is set to.
function manilaDay(value) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

// 'YYYY-MM-DD' -> "Nov 11, 2026", built from its parts so it never shifts a day.
function formatDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '')
  if (!m) return ymd || '—'
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const ASSIGN_PRIORITIES = ['critical', 'high', 'medium', 'low']
// Inspections per page in the inspection history window
const HISTORY_PAGE_SIZE = 10
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

/* ------------------------------------------------------------------ */
/* Unavailable dates (set by inspectors / technicians in the app)      */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ymdOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function leaveText(l) {
  return `${formatDay(l.start_date)}${l.end_date !== l.start_date ? ` – ${formatDay(l.end_date)}` : ''}${l.reason ? ` · ${l.reason}` : ''}`
}

// True when an unavailable-date range touches the days from..to (YYYY-MM-DD).
function leaveOverlaps(l, from, to) {
  return l.start_date <= to && l.end_date >= from
}

// On an Inspector / Technician card: their current or next unavailable
// dates (sent from the app). Red when it is today.
// Signature lines at the end of every printed report. Left blank on
// purpose: any GSO staff member may prepare a report, and both people
// sign and write their name on the printed copy.
export function ReportSignatures({ className = '' }) {
  return (
    <div className={`report-print-signatures ${className}`.trim()}>
      {['Prepared by:', 'Approved by:'].map((label) => (
        <div className="report-print-signature" key={label}>
          <div className="report-print-sig-label">{label}</div>
          <div className="report-print-sig-name" />
          <div className="report-print-sig-role">General Services Office</div>
        </div>
      ))}
    </div>
  )
}

export function LeaveLine({ leaves = [] }) {
  if (leaves.length === 0) return null
  const today = ymdOf(new Date())
  const now = leaves.find((l) => l.start_date <= today && today <= l.end_date)
  const next = now || leaves[0]
  return (
    <div className={`leave-line ${now ? 'now' : ''}`}>
      {now ? 'Unavailable today: ' : 'Unavailable soon: '}
      <b>{leaveText(next)}</b>
      {leaves.length > 1 && ` (+${leaves.length - 1} more)`}
    </div>
  )
}

// In a job order form: a warning when the person chosen is unavailable on
// any day from today to the due date — so work isn't given to someone who
// can't do it (e.g. a 2-day leave). The admin can still go ahead.
export function LeaveWarning({ name, leaves = [], from, to }) {
  const hits = leaves.filter((l) => leaveOverlaps(l, from, to || from))
  if (hits.length === 0) return null
  return (
    <div className="leave-warning">
      ⚠ <b>{name}</b> is unavailable on {hits.map(leaveText).join('; ')}. Choose someone else, or
      set a date when they are back.
    </div>
  )
}

// The calendar button on an Inspector / Technician card.
export function CalendarButton({ onClick }) {
  return (
    <button
      className="calendar-btn"
      onClick={onClick}
      title="Unavailable dates"
      aria-label="Unavailable dates"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    </button>
  )
}

// A person's month calendar (version C), opened from the calendar button on
// an inspector or technician card. Shows, day by day:
//   - their unavailable dates (migration 012) and the Available / Unavailable
//     switches they made in the app (migration 017);
//   - an inspector's inspection rounds due (migration 010) and the units they
//     inspected that day;
//   - a technician's jobs: assigned, marked repaired, completed.
// Read-only for the admin: the person sets their dates in the mobile app.
// technicianId: the technician record (jobs are linked to it, not the account).
const EVENT_STYLE = {
  leave: { bg: 'var(--gray-bg)', fg: 'var(--text)', dot: 'var(--chart-grey)', label: 'Unavailable' },
  switch: { bg: 'var(--amber-bg)', fg: 'var(--amber)', dot: 'var(--amber)', label: 'Availability switch' },
  round: { bg: 'var(--blue-light)', fg: 'var(--blue)', dot: 'var(--blue)', label: 'Inspection round due' },
  done: { bg: 'var(--green-bg)', fg: 'var(--green)', dot: 'var(--green)', label: 'Work done' },
  job: { bg: 'var(--orange-bg)', fg: 'var(--orange)', dot: '#ea580c', label: 'Job assigned' }
}

export function AvailabilityModal({ profileId, name, role, technicianId = null, onClose }) {
  const isTech = role === 'technician' || !!technicianId
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  useEffect(() => {
    async function load() {
      const leaves = await supabase
        .from('staff_unavailability')
        .select('id, start_date, end_date, reason, created_at')
        .eq('profile_id', profileId)
        .order('start_date', { ascending: true })
      if (leaves.error) {
        setError('Unavailable dates appear once the latest database update (migration 012) is run.')
        return
      }
      // Each of these is optional: before its migration it is simply empty.
      const switches = await supabase
        .from('staff_availability_changes')
        .select('*')
        .eq('profile_id', profileId)
        .order('changed_at', { ascending: true })
      let rounds = { data: [] }
      let checks = { data: [] }
      let jobs = { data: [] }
      if (isTech) {
        if (technicianId) {
          jobs = await supabase
            .from('maintenance_actions')
            .select('id, description, priority, status, repair_status, decided_at, repaired_at, completed_date, equipment ( equipment_code )')
            .eq('assigned_technician_id', technicianId)
        }
      } else {
        rounds = await supabase
          .from('inspection_assignments')
          .select('id, due_date, floor_label, priority, status, buildings ( building_name )')
          .eq('inspector_id', profileId)
          .neq('status', 'cancelled')
        checks = await supabase
          .from('inspections')
          .select('id, inspection_date, condition_status')
          .eq('inspector_id', profileId)
      }
      setData({
        leaves: leaves.data || [],
        switches: switches.error ? [] : switches.data || [],
        rounds: rounds.error ? [] : rounds.data || [],
        checks: checks.error ? [] : checks.data || [],
        jobs: jobs.error ? [] : jobs.data || []
      })
    }
    load()
  }, [profileId, technicianId, isTech])

  const today = ymdOf(new Date())
  const dayOf = (ts) => (ts ? ymdOf(new Date(ts)) : null)

  // Every event as { ymd, kind, text }, then grouped by day.
  const byDay = {}
  const add = (ymd, kind, text) => {
    if (!ymd) return
    ;(byDay[ymd] = byDay[ymd] || []).push({ kind, text })
  }
  const d = data || { leaves: [], switches: [], rounds: [], checks: [], jobs: [] }
  const inLeave = (ymd) => d.leaves.find((r) => r.start_date <= ymd && ymd <= r.end_date)
  d.switches.forEach((s) =>
    add(
      dayOf(s.changed_at),
      'switch',
      s.is_available ? 'Switched to Available' : `Switched to Unavailable${s.reason ? ` · ${s.reason}` : ''}`
    )
  )
  d.rounds.forEach((r) =>
    add(r.due_date, 'round', `${r.buildings?.building_name || 'Building'}${r.floor_label ? ` · ${r.floor_label}` : ''} round due`)
  )
  const checksPerDay = {}
  d.checks.forEach((c) => {
    const ymd = dayOf(c.inspection_date)
    if (ymd) checksPerDay[ymd] = (checksPerDay[ymd] || 0) + 1
  })
  Object.entries(checksPerDay).forEach(([ymd, n]) => add(ymd, 'done', `✓ ${n} unit${n === 1 ? '' : 's'} inspected`))
  d.jobs.forEach((j) => {
    const code = j.equipment?.equipment_code || 'Job'
    add(dayOf(j.decided_at), 'job', `${code} assigned`)
    add(dayOf(j.repaired_at), 'done', `✓ ${code} marked repaired`)
    if (j.completed_date) add(dayOf(j.completed_date), 'done', `✓ ${code} completed`)
  })

  // The month's days, with blanks before the 1st so weekdays line up.
  const first = month.getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))
  ]

  // Coming up: unavailable dates and work due in the next 14 days.
  const horizon = ymdOf(new Date(new Date().getTime() + 14 * 24 * 60 * 60 * 1000))
  const upcoming = [
    ...d.leaves
      .filter((r) => r.end_date >= today && r.start_date <= horizon)
      .map((r) => ({
        ymd: r.start_date < today ? today : r.start_date,
        kind: 'leave',
        text: `Unavailable${r.end_date !== r.start_date ? ` until ${formatDay(r.end_date)}` : ''}${r.reason ? ` · ${r.reason}` : ''}`
      })),
    ...d.rounds
      .filter((r) => r.due_date <= horizon)
      .map((r) => ({
        ymd: r.due_date,
        kind: 'round',
        text: `${r.buildings?.building_name || 'Building'}${r.floor_label ? ` · ${r.floor_label}` : ''} round due${r.due_date < today ? ' (overdue)' : ''}`
      })),
    ...d.jobs
      .filter((j) => j.status === 'in_progress' && j.repair_status !== 'repaired')
      .map((j) => ({
        ymd: dayOf(j.decided_at) || today,
        kind: 'job',
        text: `${j.equipment?.equipment_code || 'Job'} · ${j.description || 'repair'} (${j.repair_status === 'working' ? 'working on it' : 'assigned'})`
      }))
  ].sort((a, b) => a.ymd.localeCompare(b.ymd))
  const onLeaveToday = !!inLeave(today)

  return (
    <div className="modal-overlay">
      <div className="modal-box person-cal" style={{ textAlign: 'left' }}>
        <div className="person-cal-top">
          <div>
            <div className="modal-title" style={{ marginBottom: '2px' }}>{name}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {isTech ? 'Technician' : 'Inspector'} schedule · dates are set by them in the mobile app
            </div>
          </div>
          {onLeaveToday ? (
            <span className="tag tag-red">Unavailable today</span>
          ) : (
            <span className="tag tag-green">Available today</span>
          )}
        </div>

        {error ? (
          <p className="form-error">{error}</p>
        ) : data === null ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        ) : (
          <div className="person-cal-body">
            <div className="person-cal-main">
              <div className="cal-head">
                <button
                  className="btn btn-secondary btn-sm"
                  aria-label="Previous month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                >
                  ‹
                </button>
                <b>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
                <button
                  className="btn btn-secondary btn-sm"
                  aria-label="Next month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                >
                  ›
                </button>
              </div>
              <div className="pcal-grid">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="pcal-weekday">{w}</div>
                ))}
                {cells.map((day, i) => {
                  if (!day) return <div key={`b${i}`} className="pcal-day pcal-blank" />
                  const ymd = ymdOf(day)
                  const leave = inLeave(ymd)
                  const events = byDay[ymd] || []
                  return (
                    <div
                      key={ymd}
                      className={`pcal-day ${leave ? 'pcal-off' : ''} ${ymd === today ? 'pcal-today' : ''}`}
                      title={leave ? `Unavailable${leave.reason ? `: ${leave.reason}` : ''}` : ''}
                    >
                      <span className="pcal-num">{day.getDate()}</span>
                      {leave && (
                        <span className="pcal-ev" style={{ background: EVENT_STYLE.leave.bg, color: EVENT_STYLE.leave.fg }}>
                          Unavailable
                        </span>
                      )}
                      {events.slice(0, 2).map((e, k) => (
                        <span
                          key={k}
                          className="pcal-ev"
                          style={{ background: EVENT_STYLE[e.kind].bg, color: EVENT_STYLE[e.kind].fg }}
                        >
                          {e.text}
                        </span>
                      ))}
                      {events.length > 2 && (
                        <span className="pcal-more" title={events.slice(2).map((e) => e.text).join('\n')}>
                          +{events.length - 2} more
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="chart-legend">
                {(isTech ? ['leave', 'switch', 'job', 'done'] : ['leave', 'switch', 'round', 'done']).map((k) => (
                  <span key={k}>
                    <i style={{ background: EVENT_STYLE[k].dot }} />
                    {EVENT_STYLE[k].label}
                  </span>
                ))}
                <span>
                  <i style={{ background: 'transparent', border: '2px solid #f4511e' }} />
                  Today
                </span>
              </div>
            </div>

            <aside className="person-cal-side">
              <div className="assign-head">
                Coming up <span className="assign-count">{upcoming.length}</span>
              </div>
              {upcoming.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                  Nothing in the next 14 days.
                </p>
              ) : (
                upcoming.map((u, i) => (
                  <div key={i} className="pcal-up">
                    <span className="pcal-up-date" style={{ background: EVENT_STYLE[u.kind].bg, color: EVENT_STYLE[u.kind].fg }}>
                      {formatDay(u.ymd)}
                    </span>
                    <span>{u.text}</span>
                  </div>
                ))
              )}
            </aside>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '16px' }}>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// For a unit that needs a new unit (a fire extinguisher job, or work type
// "Replace whole unit" — the same rule the Purchase Request summary uses): a tag, and
// when the storeroom can't cover it, the "Needs a purchase request" button
// that opens the summary on the dashboard.
export function ReplacementNote({ action, purchaseItems = [], onOpenPurchaseSummary }) {
  if (!action || !needsReplacementUnit(action)) return null
  const needsPurchase = purchaseItems.some((p) => p.actionId === action.id)
  const open = !['completed'].includes(action.status)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
      <span className="tag tag-red">Needs New Unit</span>
      {needsPurchase ? (
        <button className="btn btn-outline-red btn-sm" onClick={onOpenPurchaseSummary}>
          Needs a purchase request
        </button>
      ) : (
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
          {open ? 'Stock on hand covers it' : 'Replaced'}
        </span>
      )}
    </div>
  )
}

function PriorityPill({ priority }) {
  if (!priority) {
    return <span className="tag tag-grey" title="No priority recorded for this inspection">No priority</span>
  }
  const p = PRIORITY_TAG[priority] || PRIORITY_TAG.medium
  return (
    <SmallTag bg={p.bg} fg={p.fg}>
      {priority} priority
    </SmallTag>
  )
}


// Live progress of one assignment, counted from the inspections this
// inspector submitted after the assignment was made. Units on hold (a
// reported defect not yet resolved) can't be inspected, so they are
// counted apart and don't block the assignment from being done.
function assignmentProgress(a, equipment, inspections) {
  const units = unitsForAssignment(a, equipment)
  const since = new Date(a.created_at).getTime()
  const inspectedIds = new Set(
    inspections
      .filter((i) => i.inspector_id === a.inspector_id && new Date(i.inspection_date).getTime() >= since)
      .map((i) => i.equipment_id)
  )
  const done = units.filter((u) => inspectedIds.has(u.id)).length
  const onHold = units.filter(
    (u) => !inspectedIds.has(u.id) && ['defective', 'for_repair', 'for_replacement'].includes(u.current_status)
  ).length
  const total = units.length - onHold
  return { done, total, onHold, complete: total > 0 && done >= total }
}

export function InspectorsTab({
  inspections = [],
  equipment = [],
  buildings = [],
  buildingLocations = [],
  actions = [],
  purchaseItems = [],
  onOpenPurchaseSummary,
  leaves = [],
  availabilityKey = '',
  adminName = ''
}) {
  const [profiles, setProfiles] = useState([])
  const [expandedKey, setExpandedKey] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', username: '', password: '' })
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  // Which inspector's Edit account window is open
  const [settingsFor, setSettingsFor] = useState(null)
  // Inspection assignments (migration 010) and the "Assign inspection" form
  const [assignments, setAssignments] = useState([])
  const [assignmentsReady, setAssignmentsReady] = useState(true)
  const [assignFor, setAssignFor] = useState(null)
  const [assignForm, setAssignForm] = useState(null)
  const [assignError, setAssignError] = useState(null)
  const [assignSaving, setAssignSaving] = useState(false)
  // The official Job Order Request filled in with the assignment, and the
  // ones already saved, by assignment (migration 020)
  const [assignDraft, setAssignDraft] = useState(null)
  const [jorByAssignment, setJorByAssignment] = useState({})
  const [jorEditorId, setJorEditorId] = useState(null)
  const [jorCreating, setJorCreating] = useState(null)
  // Whose unavailable dates are open (calendar button)
  const [calendarFor, setCalendarFor] = useState(null)
  // Filters and page for the open inspection history window
  const [histFilter, setHistFilter] = useState({ from: '', to: '', priority: '' })
  const [histPage, setHistPage] = useState(0)

  // Inspector accounts, with their usernames (migration 005). Before 005,
  // fall back to reading profiles directly; if the database rules don't
  // allow that either, the list is built from submitted inspections only.
  async function fetchInspectors() {
    const { data, error } = await supabase.rpc('list_staff_accounts')
    let list
    if (!error) {
      list = (data || []).filter((a) => a.role === 'inspector')
    } else {
      const fallback = await supabase.from('profiles').select('id, full_name, role').eq('role', 'inspector')
      list = !fallback.error && fallback.data ? fallback.data : []
    }
    // Available / Unavailable, set by each inspector in the app (migration
    // 009). Before 009 the card just shows "App account".
    const availability = await supabase.rpc('list_staff_availability')
    if (!availability.error) {
      const byId = {}
      const reasons = {}
      ;(availability.data || []).forEach((a) => {
        byId[a.id] = a.is_available
        reasons[a.id] = a.availability_reason || null
      })
      list = list.map((p) => ({ ...p, is_available: byId[p.id], availability_reason: reasons[p.id] }))
    }
    return list
  }

  // Open assignments plus cancelled ones are loaded; cancelled ones are
  // simply not shown. Before migration 010 the table doesn't exist.
  async function fetchAssignments() {
    const { data, error } = await supabase
      .from('inspection_assignments')
      .select('id, inspector_id, building_id, floor_label, due_date, priority, notes, status, created_by, created_at')
      .eq('status', 'open')
      .order('due_date', { ascending: true })
    if (error) return null
    return data || []
  }

  // Reloaded whenever an inspector switches Available / Unavailable on the
  // phone (availabilityKey is the latest switch), so the cards stay current.
  useEffect(() => {
    fetchInspectors().then(setProfiles)
  }, [availabilityKey])

  useEffect(() => {
    fetchAssignments().then((list) => {
      setAssignmentsReady(list !== null)
      setAssignments(list || [])
    })
  }, [])

  async function reloadAssignments() {
    const list = await fetchAssignments()
    setAssignmentsReady(list !== null)
    setAssignments(list || [])
  }

  // The Job Order Request form of each assignment (newest one), as
  // { [assignment id]: form }. Before migration 020 there are none (null).
  async function fetchJorForms() {
    const { data, error } = await supabase
      .from('job_order_requests')
      .select('id, inspection_assignment_id, jor_no, created_at')
      .not('inspection_assignment_id', 'is', null)
    if (error) return null
    const map = {}
    ;(data || []).forEach((j) => {
      const prev = map[j.inspection_assignment_id]
      if (!prev || j.created_at > prev.created_at) map[j.inspection_assignment_id] = j
    })
    return map
  }

  useEffect(() => {
    fetchJorForms().then((map) => map && setJorByAssignment(map))
  }, [])

  async function reloadJorForms() {
    const map = await fetchJorForms()
    if (map) setJorByAssignment(map)
  }

  // The form's place and description follow the building / floor chosen.
  function areaFields(buildingId, floorLabel) {
    const covered = unitsForAssignment({ building_id: buildingId, floor_label: floorLabel || null }, equipment).length
    const b = buildings.find((x) => x.id === buildingId)
    return {
      office_room_to: `${b?.building_name || 'Building'}${floorLabel ? ` — ${floorLabel}` : ' (whole building)'}`,
      description: inspectionDescription(covered)
    }
  }

  function changeAssignArea(buildingId, floorLabel) {
    setAssignForm((prev) => ({ ...prev, building_id: buildingId, floor_label: floorLabel }))
    setAssignDraft((prev) => (prev ? { ...prev, ...areaFields(buildingId, floorLabel) } : prev))
  }

  // An assignment made before the forms existed: its form, from the assignment.
  async function createJorForAssignment(a, inspectorName) {
    setJorCreating(a.id)
    try {
      const b = buildings.find((x) => x.id === a.building_id)
      const draft = jobOrderDraftForInspection({
        buildingName: b?.building_name,
        floorLabel: a.floor_label,
        coveredCount: unitsForAssignment(a, equipment).length,
        notes: a.notes,
        profile: { full_name: adminName }
      })
      const id = await insertJobOrderForm(draft, { inspection_assignment_id: a.id }, inspectorName)
      await reloadJorForms()
      setJorEditorId(id)
    } catch (error) {
      alert('Could not create the Job Order Request form: ' + formsErrorMessage(error))
    }
    setJorCreating(null)
  }

  // Opens the inspection Job Order Request form for this inspector.
  function openAssignForm(accountId) {
    setAssignFor(accountId)
    setAssignError(null)
    const buildingId = buildings[0]?.id || ''
    setAssignForm({
      id: crypto.randomUUID(),
      inspector_id: accountId,
      building_id: buildingId,
      floor_label: '',
      due_date: manilaDay(new Date()),
      priority: 'medium'
    })
    setAssignDraft({
      ...jobOrderDraftForInspection({ profile: { full_name: adminName }, coveredCount: 0 }),
      ...areaFields(buildingId, '')
    })
  }

  async function saveAssignment() {
    const r = { name: cleanName(profiles.find((p) => p.id === assignForm.inspector_id)?.full_name) || 'the inspector' }
    setAssignError(null)
    if (!assignForm.building_id) {
      setAssignError('Choose a building.')
      return
    }
    if (!assignForm.due_date) {
      setAssignError('Choose a due date.')
      return
    }
    if (assignForm.due_date < manilaDay(new Date())) {
      setAssignError("The due date can't be before today.")
      return
    }
    const covered = unitsForAssignment(
      { building_id: assignForm.building_id, floor_label: assignForm.floor_label || null },
      equipment
    ).length
    if (covered === 0) {
      setAssignError('There is no equipment in service there to inspect. Choose another building or floor.')
      return
    }
    const problem = checkJobOrderDraft(assignDraft)
    if (problem) {
      setAssignError(problem)
      return
    }
    setAssignSaving(true)
    if (await isJorNoTaken(assignDraft.jor_no)) {
      setAssignSaving(false)
      setAssignError(`JOR No. "${assignDraft.jor_no.trim()}" is already used by another Job Order Request.`)
      return
    }
    const { error } = await supabase.from('inspection_assignments').insert([
      {
        id: assignForm.id,
        inspector_id: assignForm.inspector_id,
        building_id: assignForm.building_id,
        floor_label: assignForm.floor_label || null,
        due_date: assignForm.due_date,
        priority: assignForm.priority,
        notes: assignDraft.remarks.trim() || null,
        created_by: adminName || null
      }
    ])
    if (error) {
      setAssignSaving(false)
      setAssignError(error.message)
      return
    }
    // The assignment is saved; its official form is saved next. A problem
    // here (e.g. migration 020 not run yet) only shows a note.
    try {
      await insertJobOrderForm(assignDraft, { inspection_assignment_id: assignForm.id }, r.name)
      reloadJorForms()
    } catch (formError) {
      alert(
        'The inspection Job Order was submitted, but its Job Order Request form could not be created: ' +
          formsErrorMessage(formError) +
          '\n\nYou can create it later from the inspector card.'
      )
    }
    setAssignSaving(false)
    const b = buildings.find((x) => x.id === assignForm.building_id)
    setNotice(
      `Job Order submitted: ${r.name} will inspect ${b?.building_name || 'the building'}${assignForm.floor_label ? ` — ${assignForm.floor_label}` : ''} on or before ${formatDay(assignForm.due_date)}. They get a notification on their phone.`
    )
    setAssignFor(null)
    reloadAssignments()
  }

  async function cancelAssignment(a, label) {
    if (!window.confirm(`Cancel this inspection assignment?\n\n${label}\n\nThe inspector is notified.`)) return
    const { error } = await supabase.from('inspection_assignments').update({ status: 'cancelled' }).eq('id', a.id)
    if (error) {
      alert('Could not cancel: ' + error.message)
      return
    }
    reloadAssignments()
  }

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

  const buildingName = (id) => buildings.find((b) => b.id === id)?.building_name || 'Building'

  // Priority of one inspection in the history — decided the same way as in
  // the Inspection Report (reports.js).
  const inspectionPriority = (i) => priorityOfInspection(i, { actions, assignments, equipment })
  // Counted the same way as the inspector's own app (get_my_stats, migration
  // 009): an inspection belongs to the account that submitted it. Only
  // inspector accounts get a card; older inspections saved before inspector
  // logins existed stay in each unit's history and in the reports.
  const rows = useMemo(() => {
    const accounts = {}
    profiles.forEach((p) => {
      const name = cleanName(p.full_name)
      accounts[p.id] = {
        key: `id-${p.id}`,
        name: name || 'Unnamed inspector',
        accountId: p.id,
        username: p.username || null,
        isAvailable: p.is_available,
        reason: p.availability_reason || null,
        items: []
      }
    })
    inspections.forEach((i) => {
      if (i.inspector_id && accounts[i.inspector_id]) accounts[i.inspector_id].items.push(i)
    })
    return Object.values(accounts)
      .map((r) => {
        const items = [...r.items].sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date))
        return {
          ...r,
          items,
          total: items.length,
          last: items[0]?.inspection_date || null
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [profiles, inspections])

  const today = manilaDay(new Date())
  const floorsFor = (buildingId) =>
    [...new Set(buildingLocations.filter((l) => l.building_id === buildingId).map((l) => l.floor_label))]

  return (
    <div>
      <div className="section-heading">
        <h2>Inspectors</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className="count-pill neutral">{rows.length} listed</span>
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

      {!assignmentsReady && (
        <p className="page-hint">
          Inspection assignments appear once the latest database update (migration 010) is run.
        </p>
      )}

      {calendarFor && (
        <AvailabilityModal
          profileId={calendarFor.id}
          name={calendarFor.name}
          role="inspector"
          onClose={() => setCalendarFor(null)}
        />
      )}

      {jorEditorId && (
        <JorEditorModal
          id={jorEditorId}
          onClose={() => setJorEditorId(null)}
          onSaved={() => {
            setJorEditorId(null)
            reloadJorForms()
          }}
        />
      )}

      {assignFor && assignForm && assignDraft && (
        <InspectionJobOrderModal
          form={assignForm}
          setForm={setAssignForm}
          onAreaChange={changeAssignArea}
          draft={assignDraft}
          onDraftChange={setAssignDraft}
          inspectors={rows}
          buildings={buildings}
          floors={floorsFor(assignForm.building_id)}
          coveredCount={
            unitsForAssignment(
              { building_id: assignForm.building_id, floor_label: assignForm.floor_label || null },
              equipment
            ).length
          }
          error={assignError}
          saving={assignSaving}
          leaves={leaves}
          onCancel={() => setAssignFor(null)}
          onSubmit={saveAssignment}
        />
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
        <div className="card-grid">
          {rows.map((r) => {
            // This inspector's open assignments: most urgent first, then
            // the earliest due date. Finished ones drop off the card.
            const mine = assignments
              .filter((a) => a.inspector_id === r.accountId)
              .map((a) => ({ ...a, progress: assignmentProgress(a, equipment, inspections) }))
              .filter((a) => !a.progress.complete)
              .sort(
                (a, b) =>
                  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.due_date.localeCompare(b.due_date)
              )

            return (
              <div key={r.key} className="info-card">
                <div className="info-card-top">
                  <strong>{r.name}</strong>
                  <span className="tag-row">
                    {r.isAvailable === undefined ? (
                      <span className="tag tag-blue">App account</span>
                    ) : (
                      <span
                        className={`tag ${r.isAvailable ? 'tag-green' : 'tag-grey'}`}
                        title="Set by the inspector in the mobile app"
                      >
                        {r.isAvailable ? 'Available' : 'Unavailable'}
                      </span>
                    )}
                    <CalendarButton onClick={() => setCalendarFor({ id: r.accountId, name: r.name })} />
                  </span>
                </div>
                <div className="info-line">
                  Username <b>{r.username || '—'}</b>
                </div>
                {r.isAvailable === false && r.reason && (
                  <div className="info-line">
                    Unavailable because <b>{r.reason}</b>
                  </div>
                )}
                <div className="info-line">
                  Last inspection <b>{r.last ? fmtDateTime(r.last) : 'None yet'}</b>
                </div>
                <LeaveLine leaves={leaves.filter((l) => l.profile_id === r.accountId)} />

                {/* Buildings to inspect, from this inspector's assignments */}
                <div className="assign-box">
                  <div className="assign-head">
                    Buildings to inspect
                    <span className="assign-count">{mine.length}</span>
                  </div>
                  {mine.length === 0 ? (
                    <div className="info-line">No buildings assigned yet.</div>
                  ) : (
                    mine.map((a) => {
                      const label = `${buildingName(a.building_id)}${a.floor_label ? ` — ${a.floor_label}` : ' (whole building)'}`
                      const late = a.due_date < today
                      const dueToday = a.due_date === today
                      const pct = a.progress.total ? Math.round((a.progress.done / a.progress.total) * 100) : 0
                      return (
                        <div key={a.id} className="assign-row">
                          <div className="assign-row-top">
                            <b>{label}</b>
                            <PriorityPill priority={a.priority} />
                          </div>
                          <div className="info-line">
                            Due <b>{formatDay(a.due_date)}</b>{' '}
                            {late ? (
                              <span className="tag tag-red">Overdue — still to do</span>
                            ) : dueToday ? (
                              <span className="tag tag-blue">Due today</span>
                            ) : null}
                            {leaves.some(
                              (l) => l.profile_id === r.accountId && leaveOverlaps(l, today, a.due_date < today ? today : a.due_date)
                            ) && (
                              <span className="tag tag-red" title="The inspector is unavailable before this is due. Reassign it or move the date.">
                                Inspector unavailable
                              </span>
                            )}
                          </div>
                          <div className="info-line">
                            {a.progress.done} of {a.progress.total} unit{a.progress.total === 1 ? '' : 's'} inspected
                            {a.progress.onHold > 0 && ` · ${a.progress.onHold} on hold (waiting for GSO)`}
                          </div>
                          <div className="assign-bar">
                            <i style={{ width: `${pct}%` }} />
                          </div>
                          {a.notes && <div className="info-line">Note: “{a.notes}”</div>}
                          <div className="info-actions" style={{ marginTop: '2px' }}>
                            {jorByAssignment[a.id] ? (
                              <>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => setJorEditorId(jorByAssignment[a.id].id)}
                                >
                                  Edit Job Order Request
                                  {jorByAssignment[a.id].jor_no ? ` ${jorByAssignment[a.id].jor_no}` : ''}
                                </button>
                                <a
                                  className="btn btn-secondary btn-sm"
                                  href={formPrintUrl('jor', jorByAssignment[a.id].id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ textDecoration: 'none' }}
                                >
                                  View / Print form
                                </a>
                              </>
                            ) : (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => createJorForAssignment(a, r.name)}
                                disabled={jorCreating === a.id}
                              >
                                {jorCreating === a.id ? 'Creating...' : 'Create Job Order Request form'}
                              </button>
                            )}
                            <button className="btn btn-outline-red btn-sm" onClick={() => cancelAssignment(a, label)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                <div className="info-actions">
                  {assignmentsReady && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => openAssignForm(r.accountId)}
                      disabled={buildings.length === 0}
                      title={buildings.length === 0 ? 'Add a building first.' : 'Fill in a Job Order Request for this inspector'}
                    >
                      Assign inspection
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setExpandedKey(r.key)
                      setHistFilter({ from: '', to: '', priority: '' })
                      setHistPage(0)
                    }}
                    disabled={r.total === 0}
                  >
                    View inspections ({r.total})
                  </button>
                  {r.accountId && r.username && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setSettingsFor({ id: r.accountId, full_name: r.name, username: r.username })}
                    >
                      Edit account
                    </button>
                  )}
                </div>

              </div>
            )
          })}
        </div>
      )}
      {/* Inspection history: its own window with a compact table, so the
          card stays short and the page doesn't need long scrolling. */}
      {expandedKey && (() => {
        const r = rows.find((x) => x.key === expandedKey)
        if (!r) return null
        // Filter by date (Philippine calendar day) and priority.
        const f = histFilter
        const shown = r.items.filter((i) => {
          const day = manilaDay(i.inspection_date)
          if (f.from && day < f.from) return false
          if (f.to && day > f.to) return false
          if (f.priority) {
            const p = inspectionPriority(i)
            if (f.priority === '__none__' ? p : p !== f.priority) return false
          }
          return true
        })
        const backwards = f.from && f.to && f.from > f.to
        const pages = Math.max(1, Math.ceil(shown.length / HISTORY_PAGE_SIZE))
        const page = Math.min(histPage, pages - 1)
        const pageItems = shown.slice(page * HISTORY_PAGE_SIZE, (page + 1) * HISTORY_PAGE_SIZE)
        const setFilter = (next) => {
          setHistFilter(next)
          setHistPage(0)
        }
        return (
          <div className="modal-overlay" onClick={() => setExpandedKey(null)}>
            <div className="modal-box history-box" onClick={(e) => e.stopPropagation()}>
              <div className="history-head">
                <div>
                  <div className="modal-title" style={{ marginBottom: '2px' }}>Inspection history</div>
                  <div className="info-line">
                    {r.name} · {r.items.length} inspection{r.items.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setExpandedKey(null)}>Close</button>
              </div>

              <div className="hist-filters">
                <label>
                  From
                  <input type="date" value={f.from} onChange={(e) => setFilter({ ...f, from: e.target.value })} />
                </label>
                <label>
                  To
                  <input type="date" value={f.to} onChange={(e) => setFilter({ ...f, to: e.target.value })} />
                </label>
                <label>
                  Priority
                  <select value={f.priority} onChange={(e) => setFilter({ ...f, priority: e.target.value })}>
                    <option value="">All</option>
                    {ASSIGN_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                    <option value="__none__">No priority</option>
                  </select>
                </label>
              </div>
              {(f.from || f.to || f.priority) && (
                <div className="info-line" style={{ marginBottom: '8px' }}>
                  {backwards ? 'The "From" date is after the "To" date.' : `Showing ${shown.length} of ${r.items.length}.`}{' '}
                  <button className="link-btn" onClick={() => setFilter({ from: '', to: '', priority: '' })}>
                    Clear filters
                  </button>
                </div>
              )}

              {backwards ? null : shown.length === 0 ? (
                <div className="info-line">No inspections match these filters.</div>
              ) : (
                <div className="history-table-wrap">
                  <table className="data-table history-table">
                    <thead>
                      <tr>
                        <th>Date and time</th>
                        <th>Code</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>Findings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((i) => {
                        const failed = i.condition_status === 'defective'
                        return (
                          <tr key={i.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(i.inspection_date)}</td>
                            <td><b>{codeById[i.equipment_id] || '—'}</b></td>
                            <td>
                              <span className={`tag ${failed ? 'tag-red' : 'tag-green'}`}>
                                {failed ? 'Defective' : 'Functional'}
                              </span>
                            </td>
                            <td><PriorityPill priority={inspectionPriority(i)} /></td>
                            <td>
                              {i.findings || '—'}
                              <ReplacementNote
                                action={actionForInspection(i, actions)}
                                purchaseItems={purchaseItems}
                                onOpenPurchaseSummary={onOpenPurchaseSummary}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!backwards && pages > 1 && (
                <div className="history-pager">
                  <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setHistPage(page - 1)}>
                    ‹ Newer
                  </button>
                  <span className="info-line">
                    Page {page + 1} of {pages} · {page * HISTORY_PAGE_SIZE + 1}–{Math.min(shown.length, (page + 1) * HISTORY_PAGE_SIZE)} of {shown.length}
                  </span>
                  <button className="btn btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => setHistPage(page + 1)}>
                    Older ›
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Job Order Request form                                              */
/* ------------------------------------------------------------------ */

// Filing a Job Order for an INSPECTOR: the admin assigns a building (or one
// floor) to inspect, with a due date and a priority, on the official Job
// Order Request form (JobOrderWindow). The assignment is saved to
// inspection_assignments (migration 010), its form to job_order_requests (020).
function InspectionJobOrderModal({
  form,
  setForm,
  onAreaChange,
  draft,
  onDraftChange,
  inspectors,
  buildings,
  floors,
  coveredCount,
  error,
  saving,
  leaves = [],
  onCancel,
  onSubmit
}) {
  const inspector = inspectors.find((i) => i.accountId === form.inspector_id)
  const set = (name) => (e) => setForm((prev) => ({ ...prev, [name]: e.target.value }))

  const assignment = (
    <>
      <div>
        <label className="field-label">Assign inspector</label>
        <select value={form.inspector_id} onChange={set('inspector_id')}>
          {inspectors.map((i) => (
            <option key={i.accountId} value={i.accountId}>
              {i.name}
              {i.isAvailable === false ? ' (Unavailable)' : i.isAvailable ? ' (Available)' : ''}
            </option>
          ))}
        </select>
        <LeaveWarning
          name={inspector?.name || 'This inspector'}
          leaves={leaves.filter((l) => l.profile_id === form.inspector_id)}
          from={ymdOf(new Date())}
          to={form.due_date}
        />
      </div>
      <div>
        <label className="field-label">Building</label>
        <select value={form.building_id} onChange={(e) => onAreaChange(e.target.value, '')}>
          {buildings.map((b) => (
            <option key={b.id} value={b.id}>{b.building_name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label">Floor</label>
        <select value={form.floor_label} onChange={(e) => onAreaChange(form.building_id, e.target.value)}>
          <option value="">Whole building</option>
          {floors.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <div className="info-line" style={{ marginTop: '4px' }}>
          {coveredCount} unit{coveredCount === 1 ? '' : 's'} in service
          {coveredCount === 0 && (
            <span style={{ color: 'var(--red)' }}> — nothing to inspect here, choose another building or floor</span>
          )}
        </div>
      </div>
      <div>
        <label className="field-label">Priority</label>
        <select value={form.priority} onChange={set('priority')}>
          {ASSIGN_PRIORITIES.map((p) => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label">Inspect on or before</label>
        <input type="date" value={form.due_date} min={ymdOf(new Date())} onChange={set('due_date')} />
      </div>
    </>
  )

  return (
    <JobOrderWindow
      title="File an inspection Job Order"
      assignmentTitle="Inspector and area"
      assignment={assignment}
      draft={draft}
      onDraftChange={onDraftChange}
      facilitatedBy={inspector?.name}
      error={error}
      saving={saving}
      submitDisabled={coveredCount === 0}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  )
}

export function JobOrderRequestModal({
  modal,
  technicians,
  fireExtinguisherStock,
  selectedTechnicianId,
  onSelectTechnician,
  draft,
  onDraftChange,
  error,
  saving,
  leaves = [],
  onCancel,
  onSubmit
}) {
  const isReassign = !!modal.isReassign
  // Warn about the chosen technician's unavailable dates in the next 7 days.
  const chosenTech = technicians.find((t) => t.id === selectedTechnicianId)
  const weekAhead = ymdOf(new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000))
  const techLeaveWarning = chosenTech?.profile_id ? (
    <LeaveWarning
      name={chosenTech.full_name}
      leaves={leaves.filter((l) => l.profile_id === chosenTech.profile_id)}
      from={ymdOf(new Date())}
      to={weekAhead}
    />
  ) : null

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
            {techLeaveWarning}
          </div>
          <div className="modal-actions" style={{ gap: '8px' }}>
            <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            <button className="btn btn-primary" onClick={onSubmit}>Save Assignment</button>
          </div>
        </div>
      </div>
    )
  }

  // The defect and what the technician needs to know, above the picker.
  const assignment = (
    <>
      <div className="info-line">
        <b>{modal.equipmentCode}</b> — {TYPE_LABELS[modal.equipmentType] || modal.equipmentType}
        {' · '}
        <span style={{ textTransform: 'capitalize' }}>{modal.priority}</span> priority
        {' · '}
        {ACTION_TYPE_LABELS[modal.actionType] || modal.actionType}
      </div>
      <div className="info-line">{modal.location}</div>
      <div className="info-line">Reported {fmtDateTime(modal.reportedDate)}</div>
      {modal.isFireExtinguisher && (
        <div className="info-line">
          Replacement stock on hand: <b>{fireExtinguisherStock}</b> fire extinguisher
          {fireExtinguisherStock === 1 ? '' : 's'}
          {fireExtinguisherStock === 0 && (
            <span style={{ color: 'var(--red)' }}> — no unit on hand, a Purchase Request is also needed</span>
          )}
        </div>
      )}
      <div>
        <label className="field-label">Assign technician</label>
        {technicianSelect}
        {techLeaveWarning}
      </div>
    </>
  )

  return (
    <JobOrderWindow
      title="File a Job Order"
      assignmentTitle="Technician"
      assignment={assignment}
      draft={draft}
      onDraftChange={onDraftChange}
      facilitatedBy={chosenTech?.full_name}
      error={error}
      saving={saving}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  )
}
