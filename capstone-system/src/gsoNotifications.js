/* =====================================================================
   gsoNotifications.js — plain logic (no components) for the GSO dashboard

   Exports:
     findPurchaseRequestItems  which equipment needs a Purchase Request
     buildGsoNotifications     builds the GSO notification list
     playNotificationSound     the short "ding" played on a new notification
   ===================================================================== */

const TYPE_LABELS = {
  fire_extinguisher: 'Fire Extinguisher',
  fire_alarm: 'Fire Alarm',
  sprinkler: 'Sprinkler',
  emergency_light: 'Emergency Light',
  smoke_detector: 'Smoke Detector'
}

// 'YYYY-MM-DD' -> "Sep 22, 2026". Built from its parts so it stays on the
// calendar day it was entered as (a bare date string is read as UTC).
function formatDateOnly(dateString) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString || '')
  if (!m) return dateString || '—'
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

/* ------------------------------------------------------------------ */
/* Purchase Requests                                                   */
/* ------------------------------------------------------------------ */

// A job needs a new unit when the work is a replacement. Every fire
// extinguisher job is a replacement — the old unit retires and a unit from
// stock takes its place — and any job whose work type is "Replace" needs one.
export function needsReplacementUnit(action) {
  return action?.equipment?.equipment_type === 'fire_extinguisher' || action?.action_type === 'replace'
}

// Equipment needs a Purchase Request when it needs a replacement unit and the
// storeroom stock cannot cover it. Stock is handed out in the order the units
// will actually use it: jobs already in progress first, then the remaining
// jobs by priority, then expired units that have no job yet.
//
// `actions` must already be sorted by priority (as the dashboard does).
export function findPurchaseRequestItems({ actions = [], expiring = [], stock = [] }) {
  const onHand = {}
  stock.forEach((s) => {
    onHand[s.equipment_type] = s.quantity_available || 0
  })
  const remaining = { ...onHand }

  const fromAction = (a) => ({
    key: `action-${a.id}`,
    actionId: a.id,
    status: a.status,
    equipmentId: a.equipment?.id,
    code: a.equipment?.equipment_code,
    type: a.equipment?.equipment_type,
    building: a.equipment?.buildings?.building_name,
    location: a.equipment?.exact_location,
    reason: a.description,
    priority: a.priority,
    date: a.reported_date
  })

  const needing = actions.filter(needsReplacementUnit)
  const demand = [
    ...needing.filter((a) => a.status === 'in_progress').map(fromAction),
    ...needing.filter((a) => a.status !== 'in_progress').map(fromAction)
  ]

  const withOpenJob = new Set(actions.map((a) => a.equipment?.id).filter(Boolean))
  expiring
    .filter(
      (e) => e.daysLeft < 0 && e.current_status !== 'no_longer_in_service' && !withOpenJob.has(e.id)
    )
    .forEach((e) => {
      demand.push({
        key: `expired-${e.id}`,
        actionId: null,
        status: 'expired',
        equipmentId: e.id,
        code: e.equipment_code,
        type: e.equipment_type,
        building: e.buildings?.building_name,
        location: e.exact_location,
        reason: `Expired on ${formatDateOnly(e.expiration_date)} — needs a replacement unit`,
        priority: 'high',
        date: e.expiration_date
      })
    })

  const result = []
  demand.forEach((d) => {
    const left = remaining[d.type] || 0
    if (left > 0) {
      remaining[d.type] = left - 1
    } else {
      result.push({ ...d, stockOnHand: onHand[d.type] || 0 })
    }
  })
  return result
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

const RECENT_COMPLETED_MS = 3 * 24 * 60 * 60 * 1000

// Which expiry reminder a unit is at, by days left (negative = expired).
export function expiryStage(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return null
  if (daysLeft < 0) return 'expired'
  if (daysLeft === 0) return 'today'
  if (daysLeft <= 7) return '7d'
  if (daysLeft <= 30) return '30d'
  if (daysLeft <= 60) return '60d'
  return null
}

const EXPIRY_NEXT = {
  '60d': 'Plan ahead: check the storeroom stock, or start a Purchase Request now so the unit arrives in time.',
  '30d': 'Arrange the replacement or refill with the Supply Office.',
  '7d': 'Replace or refill it this week. Make sure a unit is ready in the storeroom.',
  today: 'It expires today. Replace it, or have the inspector report it so a technician is assigned.',
  expired: 'It is past its expiry date. Replace it as soon as possible; it may not work in a fire.'
}

// Everything here is derived from data the dashboard already loads. Ids
// include the stage, so when something moves to a new stage (e.g. technician
// marks it repaired) it shows up as unread again — and plays the sound.
export function buildGsoNotifications({
  actions = [],
  expiring = [],
  completed = [],
  purchaseRequests = [],
  leaves = [],
  availability = [],
  checks = []
}) {
  const list = []

  // Inspections an inspector submitted as Functional in the last 3 days.
  // A Defective result already shows up as "New defect reported".
  // checks: [{ id, inspection_date, inspector_name, inspection_notes, equipment }]
  checks.forEach((c) => {
    const code = c.equipment?.equipment_code || 'Equipment'
    const type = TYPE_LABELS[c.equipment?.equipment_type] || c.equipment?.equipment_type || 'Equipment'
    const where = `${c.equipment?.buildings?.building_name ?? 'N/A'} — ${c.equipment?.exact_location ?? ''}`
    list.push({
      id: `check-${c.id}`,
      tone: 'green',
      title: `${code} inspected: Functional`,
      detail: `${type} · ${where}${c.inspector_name ? ` · by ${c.inspector_name}` : ''}${
        c.inspection_notes ? ` · "${c.inspection_notes}"` : ''
      }`,
      next: 'No action needed. The result is saved in the unit’s Inspection History.',
      time: c.inspection_date,
      timeLabel: 'Inspected',
      target: 'equipment',
      equipmentId: c.equipment?.id,
      code
    })
  })

  // Available / Unavailable switched on the phone (migration 017): each
  // person's latest switch from the last 3 days.
  // availability: [{ id, profile_id, is_available, reason, changed_at, name, role }]
  // (reason: migration 021, picked in the app when switching to Unavailable)
  availability.forEach((c) => {
    const roleLabel = c.role === 'technician' ? 'Technician' : 'Inspector'
    const isTech = c.role === 'technician'
    list.push({
      id: `availability-${c.id}`,
      tone: c.is_available ? 'green' : 'amber',
      title: c.is_available ? `${c.name} is now available` : `${c.name} is now unavailable`,
      detail: `${roleLabel} · ${!c.is_available && c.reason ? `Reason: ${c.reason}` : 'switched in the app'}`,
      next: c.is_available
        ? isTech
          ? 'They can take new job orders again.'
          : 'They can take new inspection job orders again.'
        : isTech
          ? 'Avoid giving them new job orders for now. Give urgent ones to another technician.'
          : 'Avoid giving them new inspection job orders for now. Reassign urgent ones if needed.',
      time: c.changed_at,
      timeLabel: 'Changed',
      target: 'leave',
      role: c.role,
      profileId: c.profile_id
    })
  })

  // Unavailable dates sent by inspectors / technicians from the app
  // (migration 012). Only ones that are still current or coming up.
  // leaves: [{ id, start_date, end_date, reason, created_at, name, role }]
  leaves.forEach((l) => {
    const when =
      l.end_date !== l.start_date
        ? `${formatDateOnly(l.start_date)} – ${formatDateOnly(l.end_date)}`
        : formatDateOnly(l.start_date)
    const roleLabel = l.role === 'technician' ? 'Technician' : 'Inspector'
    list.push({
      id: `leave-${l.id}`,
      tone: 'blue',
      title: `${l.name} will be unavailable`,
      detail: `${roleLabel} · ${when}${l.reason ? ` · ${l.reason}` : ''}`,
      next:
        l.role === 'technician'
          ? 'Check their job orders. Give urgent ones to another technician if they can’t wait.'
          : 'Check their inspection job orders due on these dates. Reassign or move the date if needed.',
      time: l.created_at,
      timeLabel: 'Sent',
      target: 'leave',
      role: l.role,
      profileId: l.profile_id
    })
  })

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
        timeLabel: 'Reported',
        target: 'jobOrder',
        actionId: a.id
      })
    }

    // A disposable extinguisher reported "For disposal" (migration 026)
    if (a.status === 'for_disposal') {
      list.push({
        id: `disposal-${a.id}`,
        tone: 'amber',
        title: `${code} reported for disposal`,
        detail: `${a.description} · ${where}`,
        next: 'Dispose of it, then open Priority Actions → For disposal and record it. A replacement comes from stock.',
        time: a.reported_date,
        timeLabel: 'Reported',
        target: 'jobOrder',
        actionId: a.id
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
        timeLabel: a.repaired_at ? 'Marked repaired' : 'Reported',
        target: 'inProgress',
        actionId: a.id
      })
    }

    if (a.status === 'in_progress' && a.repair_status === 'working') {
      list.push({
        id: `working-${a.id}`,
        tone: 'blue',
        title: `Technician started working on ${code}`,
        detail: where,
        next: 'No action needed yet. You will be notified when it is repaired.',
        time: a.decided_at || a.reported_date,
        timeLabel: a.decided_at ? 'Job order filed' : 'Reported',
        target: 'inProgress',
        actionId: a.id
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
        timeLabel: a.outcome_at ? 'Marked unresolved' : 'Reported',
        target: 'unresolved',
        actionId: a.id
      })
    }
  })

  // Jobs closed in the last 3 days — including ones closed automatically
  // when the technician marked them repaired, which otherwise would vanish
  // from Priority Actions without the GSO ever hearing about it.
  const now = Date.now()
  completed
    .filter((a) => a.completed_date && now - new Date(a.completed_date) <= RECENT_COMPLETED_MS)
    .forEach((a) => {
      const code = a.equipment?.equipment_code || 'Equipment'
      const isFE = a.equipment?.equipment_type === 'fire_extinguisher'
      list.push({
        id: `completed-${a.id}`,
        tone: 'green',
        title: `Repair completed: ${code}`,
        detail: `${a.description || 'Job closed'}${a.completed_by ? ` · by ${a.completed_by}` : ''}`,
        next: isFE
          ? 'The old unit is retired. Make sure its replacement is added in Equipment.'
          : 'No action needed. The record is in the Summary.',
        time: a.completed_date,
        timeLabel: 'Completed',
        target: 'summary'
      })
    })

  purchaseRequests.forEach((p) => {
    list.push({
      id: `purchase-${p.key}`,
      tone: 'amber',
      title: `Purchase Request needed: ${p.code}`,
      detail: `${TYPE_LABELS[p.type] || p.type} · ${p.building ?? 'N/A'} — ${p.location ?? ''}`,
      next: `${p.stockOnHand} ${TYPE_LABELS[p.type] || p.type} in stock. Coordinate a Purchase Request with the Supply Office.`,
      time: p.date,
      timeLabel: p.status === 'expired' ? 'Expired' : 'Reported',
      target: 'purchase'
    })
  })

  // Expiry reminders in stages (panel comment): 60, 30 and 7 days before,
  // on the day, and after. The stage is part of the id, so each new stage
  // comes back unread with the sound. Units more than 60 days out wait.
  expiring.forEach((item) => {
    const stage = expiryStage(item.daysLeft)
    if (!stage) return
    const expired = item.daysLeft < 0
    const days = Math.abs(item.daysLeft)
    list.push({
      id: `expiry-${item.id}-${item.expiration_date}-${stage}`,
      tone: expired || item.daysLeft <= 7 ? 'red' : 'amber',
      title: expired
        ? `${item.equipment_code} expired ${days} day${days === 1 ? '' : 's'} ago`
        : item.daysLeft === 0
          ? `${item.equipment_code} expires today`
          : `${item.equipment_code} expires in ${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'}`,
      detail: `${TYPE_LABELS[item.equipment_type] || item.equipment_type} · ${item.buildings?.building_name ?? 'N/A'} — ${item.exact_location ?? ''} · expiry ${formatDateOnly(item.expiration_date)}`,
      next: EXPIRY_NEXT[stage],
      time: item.expiration_date,
      timeLabel: 'Expiry date',
      target: 'expiry'
    })
  })

  // The bell re-sorts these by when each one arrived (newest first); this
  // event-time order is only the starting point.
  return list.sort((x, y) => {
    if (!x.time && !y.time) return 0
    if (!x.time) return 1
    if (!y.time) return -1
    return new Date(y.time) - new Date(x.time)
  })
}

/* ------------------------------------------------------------------ */
/* Notification sound                                                  */
/* ------------------------------------------------------------------ */

// A short two-note chime, generated in the browser (no sound file needed).
// Browsers only allow sound after the user has clicked or typed on the page
// once, so the audio is unlocked on the first interaction (e.g. signing in).
let audioCtx = null

function getAudioContext() {
  if (typeof window === 'undefined') return null
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    audioCtx = new AC()
  }
  return audioCtx
}

function unlockAudio() {
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
}

if (typeof window !== 'undefined') {
  ;['pointerdown', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, unlockAudio, { capture: true, passive: true })
  )
}

export function playNotificationSound() {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const start = ctx.currentTime + 0.01
  ;[
    [880, 0],
    [1318.5, 0.13]
  ].forEach(([freq, offset]) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, start + offset)
    gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start + offset)
    osc.stop(start + offset + 0.55)
  })
}
