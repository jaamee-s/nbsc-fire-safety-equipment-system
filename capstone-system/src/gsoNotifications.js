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
      const days = Math.abs(e.daysLeft)
      demand.push({
        key: `expired-${e.id}`,
        actionId: null,
        status: 'expired',
        equipmentId: e.id,
        code: e.equipment_code,
        type: e.equipment_type,
        building: e.buildings?.building_name,
        location: e.exact_location,
        reason: `Expired ${days} day${days === 1 ? '' : 's'} ago — needs a replacement unit`,
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

// Everything here is derived from data the dashboard already loads. Ids
// include the stage, so when something moves to a new stage (e.g. technician
// marks it repaired) it shows up as unread again — and plays the sound.
export function buildGsoNotifications({
  actions = [],
  expiring = [],
  completed = [],
  purchaseRequests = []
}) {
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
      target: 'purchase'
    })
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
