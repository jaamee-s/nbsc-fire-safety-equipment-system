import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { TYPE_LABELS, STATUS_LABELS, relativeTime } from './lib/inspector'

/* =====================================================================
   Notifications.js  (put this file next to App.js in the mobile project)

   Exports:
     useNotifications      builds the list + tracks read/unread per account
     NotificationBell      bell button for the header
     NotificationsScreen   the full notifications screen
     InspectorSummary      summary card for the inspector dashboard
     TechnicianSummary     summary card for the technician dashboard
   ===================================================================== */

const C = {
  navy: '#0F2A4A',
  blue: '#2563EB',
  blueBg: '#EAF1FF',
  green: '#15803D',
  greenBg: '#EAFAF0',
  red: '#B91C1C',
  redBg: '#FDEEEE',
  amber: '#B45309',
  amberBg: '#FFF8E8',
  border: '#E3E8EF',
  text: '#1E293B',
  muted: '#64748B',
  white: '#FFFFFF'
}

const TONES = {
  blue: { bar: C.blue, bg: C.blueBg },
  green: { bar: C.green, bg: C.greenBg },
  red: { bar: C.red, bg: C.redBg },
  amber: { bar: C.amber, bg: C.amberBg }
}

/* ------------------------------------------------------------------ */
/* Building the notification lists from the dashboard data             */
/* No database change needed — these come from what the dashboards     */
/* already load. The id includes the stage, so when a job moves to     */
/* a new stage it shows up as unread again.                            */
/* ------------------------------------------------------------------ */

function buildTechnicianNotifications(data) {
  const list = []

  ;(data.assigned || []).forEach((j) => {
    const st = j.repair_status || 'assigned'
    const remarks = (j.job_order_remarks || '').trim()
    let title
    let next
    let tone = 'blue'

    if (st === 'assigned') {
      title = `New job order: ${j.equipment_code}`
      next = 'Open the job and tap "Start working" when you begin the repair.'
      tone = 'amber'
    } else if (st === 'working') {
      title = `In progress: ${j.equipment_code}`
      next = 'When the repair is finished, tap "Mark as repaired" so GSO can verify it.'
    } else {
      title = `Waiting for GSO: ${j.equipment_code}`
      next =
        'Nothing more to do for now. GSO will verify the unit and close the job. If it is sent back to you, it will appear here again.'
      tone = 'green'
    }

    list.push({
      id: `job-${j.id}-${st}`,
      kind: 'job',
      jobId: j.id,
      code: j.equipment_code,
      title,
      gso: remarks || null,
      detail: `${TYPE_LABELS[j.equipment_type] || j.equipment_type} · ${j.description}`,
      next,
      time: j.decided_at,
      tone
    })
  })

  ;(data.recent_done || []).forEach((r) => {
    list.push({
      id: `done-${r.id}`,
      kind: 'done',
      code: r.equipment_code,
      title: `Job closed: ${r.equipment_code}`,
      gso: null,
      detail: r.description,
      next: 'No further action needed. Thank you for the repair.',
      time: r.completed_date,
      tone: 'green'
    })
  })

  return list
}

function buildInspectorNotifications(data) {
  const list = []

  ;(data.on_hold || []).forEach((d) => {
    list.push({
      id: `hold-${d.id}-${d.current_status}`,
      kind: 'hold',
      code: d.equipment_code,
      title: `On hold: ${d.equipment_code}`,
      gso: null,
      detail: `${STATUS_LABELS[d.current_status] || d.current_status} · ${d.building_name || ''} ${d.exact_location || ''}`.trim(),
      next:
        'GSO is handling the reported defect. You can inspect this unit again once GSO records the outcome.',
      time: null,
      tone: 'amber'
    })
  })

  ;(data.recent || [])
    .filter((r) => r.condition_status === 'defective')
    .slice(0, 3)
    .forEach((r) => {
      list.push({
        id: `report-${r.id}`,
        kind: 'report',
        code: r.equipment_code,
        title: `Your defect report was sent: ${r.equipment_code}`,
        gso: null,
        detail: r.findings || 'Defective',
        next: 'GSO has been notified. No action needed from you.',
        time: r.inspection_date,
        tone: 'blue'
      })
    })

  ;(data.due || [])
    .filter((d) => d.current_status !== 'no_longer_in_service')
    .slice(0, 5)
    .forEach((d) => {
      list.push({
        id: `due-${d.id}-${d.last_inspected || 'never'}`,
        kind: 'due',
        code: d.equipment_code,
        title: d.last_inspected
          ? `Due for inspection: ${d.equipment_code}`
          : `Never inspected: ${d.equipment_code}`,
        gso: null,
        detail: `${TYPE_LABELS[d.equipment_type] || d.equipment_type} · ${d.building_name || ''} ${d.exact_location || ''}`.trim(),
        next: 'Scan its QR sticker (or enter the code) and submit an inspection.',
        time: d.last_inspected || null,
        tone: d.last_inspected ? 'blue' : 'red'
      })
    })

  // Items with a time first (newest first), the rest keep their order after.
  const dated = list
    .filter((n) => n.time && n.kind === 'report')
    .sort((a, b) => new Date(b.time) - new Date(a.time))
  const rest = list.filter((n) => !(n.time && n.kind === 'report'))
  const holds = rest.filter((n) => n.kind === 'hold')
  const dues = rest.filter((n) => n.kind === 'due')
  return [...holds, ...dated, ...dues]
}

/* ------------------------------------------------------------------ */
/* Read / unread state                                                 */
/* ------------------------------------------------------------------ */

export function useNotifications(account, data) {
  const key = account ? `notif_seen_${account.id}` : null
  const [seen, setSeen] = useState(null) // null = still loading

  useEffect(() => {
    setSeen(null)
    if (!key) return
    AsyncStorage.getItem(key)
      .then((v) => {
        try {
          setSeen(v ? JSON.parse(v) : [])
        } catch (e) {
          setSeen([])
        }
      })
      .catch(() => setSeen([]))
  }, [key])

  const notifications = useMemo(() => {
    if (!account || !data) return []
    return account.role === 'technician'
      ? buildTechnicianNotifications(data)
      : buildInspectorNotifications(data)
  }, [account, data])

  const seenSet = useMemo(() => new Set(seen || []), [seen])

  const items = useMemo(
    () => notifications.map((n) => ({ ...n, unread: seen !== null && !seenSet.has(n.id) })),
    [notifications, seen, seenSet]
  )
  const unread = items.filter((n) => n.unread).length

  function persist(list) {
    setSeen(list)
    if (key) AsyncStorage.setItem(key, JSON.stringify(list.slice(-300))).catch(() => {})
  }

  function markSeen(id) {
    if (seen === null || seenSet.has(id)) return
    persist([...seen, id])
  }

  function markAllSeen() {
    if (seen === null) return
    persist([...new Set([...seen, ...notifications.map((n) => n.id)])])
  }

  return { items, unread, markSeen, markAllSeen }
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

export function NotificationBell({ count, onPress }) {
  return (
    <Pressable onPress={onPress} style={n.bell} hitSlop={8} accessibilityLabel="Notifications">
      <Text style={n.bellIcon}>🔔</Text>
      {count > 0 && (
        <View style={n.badge}>
          <Text style={n.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </Pressable>
  )
}

export function NotificationsScreen({ role, items, onOpen, onMarkAll, onBack }) {
  const [error, setError] = useState(null)
  const unread = items.filter((i) => i.unread).length

  async function open(item) {
    setError(null)
    try {
      await onOpen(item)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <ScrollView contentContainerStyle={n.scroll}>
      <View style={n.headRow}>
        <Text style={n.h1}>Notifications</Text>
        <Pressable onPress={onMarkAll} disabled={unread === 0}>
          <Text style={[n.link, unread === 0 && { opacity: 0.4 }]}>Mark all as read</Text>
        </Pressable>
      </View>
      <Text style={n.hint}>
        {role === 'technician'
          ? 'Messages from the GSO and what to do next.'
          : 'Updates on your inspections and what to do next.'}
      </Text>

      {error && <Text style={n.error}>{error}</Text>}

      {items.length === 0 ? (
        <View style={n.card}>
          <Text style={n.muted}>You&apos;re all caught up. Nothing new right now.</Text>
        </View>
      ) : (
        items.map((item) => {
          const tone = TONES[item.tone] || TONES.blue
          return (
            <Pressable
              key={item.id}
              onPress={() => open(item)}
              style={[
                n.card,
                { borderLeftWidth: 5, borderLeftColor: tone.bar },
                item.unread && { backgroundColor: tone.bg }
              ]}
            >
              <View style={n.titleRow}>
                <Text style={[n.title, item.unread && { fontWeight: '800' }]}>{item.title}</Text>
                {item.unread && <View style={[n.dot, { backgroundColor: tone.bar }]} />}
              </View>

              {item.gso !== undefined && item.kind === 'job' && (
                <View style={n.gsoBox}>
                  <Text style={n.gsoLabel}>GSO says</Text>
                  <Text style={n.gsoText}>
                    {item.gso ? `"${item.gso}"` : 'GSO assigned this repair to you. No special instructions.'}
                  </Text>
                </View>
              )}

              <Text style={n.detail}>{item.detail}</Text>

              <View style={n.nextBox}>
                <Text style={n.nextLabel}>What to do next</Text>
                <Text style={n.nextText}>{item.next}</Text>
              </View>

              {item.time ? <Text style={n.time}>{relativeTime(item.time)}</Text> : null}
            </Pressable>
          )
        })
      )}

      <Pressable style={n.backBtn} onPress={onBack}>
        <Text style={n.backText}>Back</Text>
      </Pressable>
    </ScrollView>
  )
}

/* ------------------------------------------------------------------ */
/* Dashboard summaries                                                 */
/* ------------------------------------------------------------------ */

const PREFIX_TYPES = {
  FE: 'fire_extinguisher',
  FA: 'fire_alarm',
  SR: 'sprinkler',
  EL: 'emergency_light',
  SD: 'smoke_detector'
}

function SumRow({ label, value, color, last }) {
  return (
    <View style={[n.sumRow, last && { borderBottomWidth: 0 }]}>
      <Text style={n.sumLabel}>{label}</Text>
      <Text style={[n.sumValue, color && { color }]}>{value}</Text>
    </View>
  )
}

export function InspectorSummary({ data }) {
  const recent = data.recent || []
  const bad = recent.filter((r) => r.condition_status === 'defective').length
  const good = recent.length - bad
  const onHold = (data.on_hold || []).length
  const due = (data.due || []).length
  const last = recent[0] ? recent[0].inspection_date : null

  const byType = {}
  recent.forEach((r) => {
    const t = PREFIX_TYPES[(r.equipment_code || '').split('-')[0]]
    if (t) byType[t] = (byType[t] || 0) + 1
  })
  const typeEntries = Object.entries(byType)

  return (
    <View style={n.sumCard}>
      <Text style={n.sumTitle}>My summary</Text>

      <SumRow label="Inspections today" value={data.today_count ?? 0} />
      <SumRow label="Inspections this week" value={data.week_count ?? 0} />
      <SumRow label="Defects found (total)" value={data.defect_count ?? 0} color={data.defect_count > 0 ? C.red : undefined} />
      <SumRow label="Units on hold (waiting for GSO)" value={onHold} color={onHold > 0 ? C.amber : undefined} />
      <SumRow label="Units due for inspection" value={due} />
      <SumRow label="Last inspection" value={last ? relativeTime(last) : 'None yet'} last />

      {recent.length > 0 && (
        <>
          <Text style={n.sumSub}>Your last {recent.length} inspections</Text>
          <View style={n.bar}>
            {good > 0 && <View style={{ flex: good, backgroundColor: C.green }} />}
            {bad > 0 && <View style={{ flex: bad, backgroundColor: C.red }} />}
          </View>
          <View style={n.legendRow}>
            <Text style={[n.legend, { color: C.green }]}>{good} functional</Text>
            <Text style={[n.legend, { color: C.red }]}>{bad} defective</Text>
          </View>

          {typeEntries.length > 0 && (
            <View style={n.chipRow}>
              {typeEntries.map(([t, c]) => (
                <View key={t} style={n.typeChip}>
                  <Text style={n.typeChipText}>
                    {TYPE_LABELS[t]}: {c}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  )
}

export function TechnicianSummary({ data }) {
  const jobs = data.assigned || []
  const todo = data.to_do_count ?? 0
  const awaiting = data.awaiting_gso_count ?? 0
  const done = data.done_count ?? 0
  const total = todo + awaiting + done
  const working = jobs.filter((j) => j.repair_status === 'working').length
  const urgent = jobs.filter((j) => j.priority === 'critical' || j.priority === 'high').length
  const lastDone = (data.recent_done || [])[0]
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <View style={n.sumCard}>
      <Text style={n.sumTitle}>My summary</Text>

      <SumRow label="Jobs handled (all time)" value={total} />
      <SumRow label="Still to do" value={todo} color={todo > 0 ? C.amber : undefined} />
      <SumRow label="Working on now" value={working} color={working > 0 ? C.blue : undefined} />
      <SumRow label="High / critical in your queue" value={urgent} color={urgent > 0 ? C.red : undefined} />
      <SumRow label="Marked repaired, awaiting GSO" value={awaiting} />
      <SumRow label="Closed by GSO" value={done} color={done > 0 ? C.green : undefined} />
      <SumRow label="Last job closed" value={lastDone ? relativeTime(lastDone.completed_date) : 'None yet'} last />

      {total > 0 && (
        <>
          <Text style={n.sumSub}>Completion</Text>
          <View style={n.bar}>
            {done > 0 && <View style={{ flex: done, backgroundColor: C.green }} />}
            {total - done > 0 && <View style={{ flex: total - done, backgroundColor: C.border }} />}
          </View>
          <Text style={[n.legend, { color: C.muted, marginTop: 6 }]}>
            {pct}% of your jobs are closed
          </Text>
        </>
      )}
    </View>
  )
}

/* ------------------------------------------------------------------ */

const n = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },

  bell: {
    width: 38,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 999
  },
  bellIcon: { fontSize: 16 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4
  },
  badgeText: { color: C.white, fontSize: 11, fontWeight: '800' },

  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h1: { fontSize: 20, fontWeight: '700', color: C.text },
  link: { fontSize: 13, color: C.blue, fontWeight: '600' },
  hint: { fontSize: 12, color: C.muted, marginTop: 2, marginBottom: 12 },
  error: { color: C.red, fontSize: 14, marginBottom: 10 },
  muted: { fontSize: 14, color: C.muted, lineHeight: 20 },

  card: {
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 12
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text },
  dot: { width: 10, height: 10, borderRadius: 5 },
  detail: { fontSize: 13, color: C.muted, marginTop: 6, lineHeight: 18 },

  gsoBox: {
    backgroundColor: C.blueBg,
    borderRadius: 8,
    padding: 10,
    marginTop: 10
  },
  gsoLabel: { fontSize: 11, fontWeight: '800', color: C.blue, letterSpacing: 0.5 },
  gsoText: { fontSize: 14, color: C.text, marginTop: 3, lineHeight: 20 },

  nextBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 10
  },
  nextLabel: { fontSize: 11, fontWeight: '800', color: C.muted, letterSpacing: 0.5 },
  nextText: { fontSize: 13, color: C.text, marginTop: 3, lineHeight: 19 },
  time: { fontSize: 11, color: C.muted, marginTop: 8 },

  backBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  backText: { color: C.muted, fontSize: 15, fontWeight: '600' },

  sumCard: {
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 20
  },
  sumTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 4 },
  sumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12
  },
  sumLabel: { fontSize: 14, color: C.muted, flexShrink: 1 },
  sumValue: { fontSize: 15, fontWeight: '800', color: C.text },
  sumSub: { fontSize: 12, fontWeight: '700', color: C.muted, marginTop: 14, marginBottom: 6 },
  bar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: C.border
  },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  legend: { fontSize: 12, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  typeChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  typeChipText: { fontSize: 12, color: C.muted, fontWeight: '600' }
})