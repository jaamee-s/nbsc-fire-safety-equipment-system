// ---------------------------------------------------------------------------
// Offline mode for inspectors (survey: "cannot be used without internet").
//
// 1. A copy of the equipment list is kept on the phone and refreshed while
//    online, so scanning still finds a unit without signal.
// 2. An inspection submitted without signal is kept on the phone (the
//    waiting list) and sent by itself when the signal is back: when the app
//    opens, when it comes back to the screen, and every 30 seconds.
// 3. The database stamps an inspection with the time it arrives, so the
//    real inspection time is written into its notes.
// Everything is stored with AsyncStorage, on this phone only.
// ---------------------------------------------------------------------------
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

const EQUIPMENT_KEY = 'firescan-offline-equipment'
const QUEUE_KEY = 'firescan-offline-queue'

export function isNetworkError(err) {
  const message = err?.message || String(err || '')
  return /network request failed|failed to fetch|network error|timed out|no connection/i.test(message)
}

/* ------------------------------ Equipment copy ----------------------------- */

// Saves the equipment list on the phone. Quietly does nothing without signal.
export async function refreshEquipmentCopy() {
  try {
    const { data, error } = await supabase
      .from('equipment')
      .select(
        'id, equipment_code, equipment_type, qr_code, building_id, exact_location, expiration_date, current_status, description, buildings ( building_name )'
      )
    if (error || !data) return false
    await AsyncStorage.setItem(EQUIPMENT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), items: data }))
    return true
  } catch {
    return false
  }
}

// The saved copy of one unit, by its QR code or equipment code, or null.
export async function findInEquipmentCopy(code) {
  try {
    const raw = await AsyncStorage.getItem(EQUIPMENT_KEY)
    if (!raw) return null
    const { savedAt, items } = JSON.parse(raw)
    const c = (code || '').trim().toUpperCase()
    const hit = (items || []).find(
      (e) => (e.qr_code || '').trim().toUpperCase() === c || (e.equipment_code || '').trim().toUpperCase() === c
    )
    return hit ? { ...hit, _offline: true, _savedAt: savedAt } : null
  } catch {
    return null
  }
}

/* ------------------------------ Waiting list ------------------------------ */

const listeners = new Set()

async function readQueue() {
  try {
    return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || '[]')
  } catch {
    return []
  }
}

async function writeQueue(list) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(list))
  listeners.forEach((fn) => fn(list))
}

// Tells `fn` the waiting list now and whenever it changes. Returns a stop function.
export function watchQueue(fn) {
  listeners.add(fn)
  readQueue().then(fn)
  return () => listeners.delete(fn)
}

function stampNotes(notes, at) {
  const when = new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  const stamp = `Inspected offline on ${when}; sent when the signal came back.`
  return notes && notes.trim() ? `${notes.trim()}\n${stamp}` : stamp
}

// Keeps an inspection on the phone to send later. `args` are the
// submitInspection arguments; `label` is shown in the waiting list.
export async function queueInspection(args, label) {
  const list = await readQueue()
  const at = new Date().toISOString()
  list.push({
    id: `${at}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: at,
    label,
    // inspectedAt: the real time, saved by the database (migration 026).
    args: { ...args, inspectedAt: at, inspectionNotes: stampNotes(args.inspectionNotes, at) },
    error: null
  })
  await writeQueue(list)
}

let sending = false

// Sends the waiting inspections, oldest first, with `send(args)`. Stops at
// the first one that fails for lack of signal. One the database refuses
// (e.g. the unit was retired meanwhile) is kept with the reason, so the
// inspector sees it and can remove it. Returns how many were sent.
export async function sendQueue(send) {
  if (sending) return 0
  sending = true
  let sent = 0
  try {
    let list = await readQueue()
    for (const item of [...list]) {
      if (item.error) continue
      try {
        await send(item.args)
        list = list.filter((x) => x.id !== item.id)
        sent += 1
        await writeQueue(list)
      } catch (err) {
        if (isNetworkError(err)) break
        list = list.map((x) => (x.id === item.id ? { ...x, error: err.message || String(err) } : x))
        await writeQueue(list)
      }
    }
  } finally {
    sending = false
  }
  return sent
}

// Removes one waiting inspection (one the database refused).
export async function removeQueued(id) {
  await writeQueue((await readQueue()).filter((x) => x.id !== id))
}
