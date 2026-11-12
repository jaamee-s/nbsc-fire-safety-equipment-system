import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View
} from 'react-native'

import {
  REPAIR_STATUS_LABELS,
  TYPE_LABELS,
  getInspectorDashboard,
  getMyStats,
  getTechnicianDashboard,
  relativeTime
} from './lib/inspector'

const C = {
  navy: '#0F2A4A',
  blue: '#2563EB',
  green: '#15803D',
  greenBg: '#EAFAF0',
  red: '#B91C1C',
  redBg: '#FDEEEE',
  amber: '#B45309',
  orange: '#C2410C',
  grey: '#94A3B8',
  border: '#E3E8EF',
  text: '#1E293B',
  muted: '#64748B',
  white: '#FFFFFF'
}

const PRIORITY_COLORS = { critical: C.red, high: C.orange, medium: C.amber, low: C.blue }

function Section({ title, right, children }) {
  return (
    <View style={st.card}>
      <View style={st.sectionHead}>
        <Text style={st.sectionTitle}>{title}</Text>
        {right ? <Text style={st.sectionRight}>{right}</Text> : null}
      </View>
      {children}
    </View>
  )
}

function Line({ label, value, last }) {
  return (
    <View style={[st.line, last && { borderBottomWidth: 0 }]}>
      <Text style={st.lineLabel}>{label}</Text>
      <Text style={st.lineValue}>{value}</Text>
    </View>
  )
}

// Column graph. Each column is one day or one week: a green part and,
// optionally, a red part on top.
function Columns({ items }) {
  const max = Math.max(1, ...items.map((i) => i.a + (i.b || 0)))
  return (
    <View>
      <View style={st.cols}>
        {items.map((i) => {
          const total = i.a + (i.b || 0)
          return (
            <View key={i.key} style={st.col}>
              <Text style={st.colValue}>{total}</Text>
              <View style={[st.colBar, { height: Math.max(total > 0 ? 4 : 0, (total / max) * 90) }]}>
                {i.b > 0 && <View style={{ flex: i.b, backgroundColor: C.red }} />}
                {i.a > 0 && <View style={{ flex: i.a, backgroundColor: i.color || C.green }} />}
              </View>
            </View>
          )
        })}
      </View>
      <View style={st.axis}>
        {items.map((i) => (
          <Text key={i.key} style={st.axisLabel} numberOfLines={1}>
            {i.label}
          </Text>
        ))}
      </View>
    </View>
  )
}

// Horizontal bars: one row per item.
function HBars({ items, empty }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.length === 0) return <Text style={st.hint}>{empty}</Text>
  return items.map((i) => (
    <View key={i.label} style={st.hbRow}>
      <Text style={st.hbLabel} numberOfLines={1}>
        {i.label}
      </Text>
      <View style={st.hbTrack}>
        {i.value > 0 && <View style={{ width: `${(i.value / max) * 100}%`, height: '100%', borderRadius: 99, backgroundColor: i.color }} />}
      </View>
      <Text style={st.hbValue}>{i.value}</Text>
    </View>
  ))
}

// One bar split into parts, with a legend and the first part's percentage.
function SplitBar({ parts }) {
  const total = parts.reduce((n, p) => n + p.value, 0)
  return (
    <View>
      <View style={st.splitRow}>
        <Text style={st.splitPct}>{total > 0 ? `${Math.round((parts[0].value / total) * 100)}%` : '—'}</Text>
        <Text style={st.hint}>{parts[0].label.toLowerCase()}</Text>
      </View>
      <View style={st.split}>
        {total > 0 &&
          parts.map((p) => (p.value > 0 ? <View key={p.label} style={{ flex: p.value, backgroundColor: p.color }} /> : null))}
      </View>
      <View style={st.legend}>
        {parts.map((p) => (
          <View key={p.label} style={st.legendItem}>
            <View style={[st.legendDot, { backgroundColor: p.color }]} />
            <Text style={st.legendText}>
              {p.value} {p.label.toLowerCase()}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// 'YYYY-MM-DD' -> a local date, without the one-day shift a bare date string
// gets when read as UTC.
function dayDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(ymd)
}

const shortDay = (ymd) => dayDate(ymd).toLocaleDateString(undefined, { weekday: 'short' })
const shortDate = (ymd) => dayDate(ymd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// days: 28 rows, oldest first. Week = the last 7 days, one column per day.
// Month = the 28 days as 4 columns of 7 days each.
function periodColumns(days, period, pick) {
  if (period === 'week') {
    return days.slice(-7).map((d) => ({ key: d.day, label: shortDay(d.day), ...pick([d]) }))
  }
  const out = []
  for (let w = 0; w < 4; w++) {
    const chunk = days.slice(w * 7, w * 7 + 7)
    if (chunk.length) out.push({ key: chunk[0].day, label: shortDate(chunk[0].day), ...pick(chunk) })
  }
  return out
}

function rangeText(days, period) {
  const list = period === 'week' ? days.slice(-7) : days
  if (!list.length) return ''
  return `${shortDate(list[0].day)} – ${shortDate(list[list.length - 1].day)}`
}

function newest(list, key) {
  let best = null
  list.forEach((x) => {
    if (x[key] && (!best || new Date(x[key]) > new Date(best))) best = x[key]
  })
  return best
}

// "Most reported problems" from the dashboard's recent inspections.
function topFindings(data) {
  const counts = {}
  ;(data.recent || [])
    .filter((r) => r.condition_status === 'defective')
    .forEach((r) => {
      const f = (r.findings || 'Defective').trim()
      counts[f] = (counts[f] || 0) + 1
    })
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
}

export default function SummaryScreen({ role, account, onBack }) {
  const isTech = role === 'technician'
  const [data, setData] = useState(null)
  const [stats, setStats] = useState(null)
  const [period, setPeriod] = useState('week')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [generated, setGenerated] = useState(new Date())

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setError(null)
      try {
        const [main, mine] = await Promise.all([
          isTech ? getTechnicianDashboard() : getInspectorDashboard(),
          // Before migration 009 there are no graph numbers; the screen
          // then shows the lists only.
          getMyStats().catch(() => null)
        ])
        setData(main)
        setStats(mine)
        setGenerated(new Date())
      } catch (err) {
        if (!silent) setError(err.message)
      }
      setLoading(false)
    },
    [isTech]
  )

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load(true)
    })
    return () => sub.remove()
  }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const days = (stats && (isTech ? stats.done_days : stats.days)) || []
  const periodLabel = period === 'week' ? 'last 7 days' : 'last 4 weeks'

  // Inspector numbers for the chosen period
  let insp = null
  if (data && !isTech) {
    const inPeriod = period === 'week' ? days.slice(-7) : days
    insp = {
      columns: periodColumns(days, period, (chunk) => ({
        a: chunk.reduce((n, d) => n + Number(d.functional || 0), 0),
        b: chunk.reduce((n, d) => n + Number(d.defective || 0), 0)
      })),
      functional: inPeriod.reduce((n, d) => n + Number(d.functional || 0), 0),
      defective: inPeriod.reduce((n, d) => n + Number(d.defective || 0), 0),
      byType: ((stats && (period === 'week' ? stats.defects_by_type_7 : stats.defects_by_type_28)) || []).map((t) => ({
        label: TYPE_LABELS[t.type] || t.type,
        value: Number(t.count || 0),
        color: C.red
      })),
      topFindings: topFindings(data),
      dueCount: data.due_count != null ? data.due_count : (data.due || []).length,
      holdCount: data.on_hold_count != null ? data.on_hold_count : (data.on_hold || []).length,
      last: newest(data.recent || [], 'inspection_date')
    }
  }

  // Technician numbers for the chosen period
  let tech = null
  if (data && isTech) {
    const inPeriod = period === 'week' ? days.slice(-7) : days
    const assigned = data.assigned || []
    const prio = (stats && stats.by_priority) || {
      critical: assigned.filter((j) => j.repair_status !== 'repaired' && j.priority === 'critical').length,
      high: assigned.filter((j) => j.repair_status !== 'repaired' && j.priority === 'high').length,
      medium: assigned.filter((j) => j.repair_status !== 'repaired' && j.priority === 'medium').length,
      low: assigned.filter((j) => j.repair_status !== 'repaired' && j.priority === 'low').length
    }
    tech = {
      columns: periodColumns(days, period, (chunk) => ({
        a: chunk.reduce((n, d) => n + Number(d.count || 0), 0),
        b: 0
      })),
      doneInPeriod: inPeriod.reduce((n, d) => n + Number(d.count || 0), 0),
      byPriority: ['critical', 'high', 'medium', 'low'].map((p) => ({
        label: p.charAt(0).toUpperCase() + p.slice(1),
        value: Number(prio[p] || 0),
        color: PRIORITY_COLORS[p]
      })),
      assignedCount: stats ? stats.assigned : data.to_do_count ?? 0,
      awaiting: stats ? stats.awaiting_gso : data.awaiting_gso_count ?? 0,
      completed: stats ? stats.completed : data.done_count ?? 0,
      last: newest(data.recent_done || [], 'completed_date')
    }
  }

  function shareText() {
    if (!data) return ''
    const head = `FireSafety Tech&Inspect summary\n${account.full_name} (${isTech ? 'Technician' : 'Inspector'})\n${generated.toLocaleString()}\n`
    if (isTech) {
      return (
        head +
        `\nAssigned: ${tech.assignedCount}\nAwaiting GSO: ${tech.awaiting}\nCompleted: ${tech.completed}\n` +
        (stats ? `Completed in the ${periodLabel}: ${tech.doneInPeriod}\n` : '') +
        `Open jobs — Critical: ${tech.byPriority[0].value} · High: ${tech.byPriority[1].value} · Medium: ${tech.byPriority[2].value} · Low: ${tech.byPriority[3].value}`
      )
    }
    return (
      head +
      `\nInspections today: ${stats ? stats.today : data.today_count ?? 0}\nThis week: ${stats ? stats.week : data.week_count ?? 0}\n` +
      (stats ? `Total: ${stats.total}\n` : '') +
      `Defects found: ${stats ? stats.defects : data.defect_count ?? 0}\n` +
      (stats ? `In the ${periodLabel}: ${insp.functional} functional, ${insp.defective} defective\n` : '') +
      `Can be inspected: ${insp.dueCount}\nOn hold (waiting for GSO): ${insp.holdCount}`
    )
  }

  return (
    <ScrollView
      contentContainerStyle={st.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={st.h1}>My Summary</Text>
      <Text style={st.sub}>
        {account.full_name} · updated {generated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </Text>

      {error && (
        <View style={[st.card, { backgroundColor: C.redBg }]}>
          <Text style={{ color: C.red, fontSize: 14 }}>{error}</Text>
        </View>
      )}

      {loading && !data && (
        <View style={[st.card, { alignItems: 'center', paddingVertical: 26 }]}>
          <ActivityIndicator color={C.blue} />
        </View>
      )}

      {data && stats && (
        <View style={st.chipRow}>
          {[
            ['week', 'This week'],
            ['month', 'This month']
          ].map(([key, label]) => (
            <Pressable key={key} style={[st.chip, period === key && st.chipOn]} onPress={() => setPeriod(key)}>
              <Text style={[st.chipText, period === key && st.chipTextOn]}>{label}</Text>
            </Pressable>
          ))}
          <Text style={st.range}>{rangeText(days, period)}</Text>
        </View>
      )}

      {data && !stats && (
        <View style={st.card}>
          <Text style={st.hint}>The graphs appear once the GSO runs the latest database update.</Text>
        </View>
      )}

      {insp && (
        <>
          {stats && (
            <>
              <Section
                title={period === 'week' ? 'Inspections per day' : 'Inspections per week'}
                right={`${insp.functional + insp.defective} total`}
              >
                <Columns items={insp.columns} />
              </Section>

              <Section title="Results" right={periodLabel}>
                <SplitBar
                  parts={[
                    { label: 'Functional', value: insp.functional, color: C.green },
                    { label: 'Defective', value: insp.defective, color: C.red }
                  ]}
                />
              </Section>

              <Section title="Defects by type" right={periodLabel}>
                <HBars items={insp.byType} empty="No defects found in this period." />
              </Section>
            </>
          )}

          {insp.topFindings.length > 0 && (
            <Section title="Most reported problems">
              {insp.topFindings.map(([label, n], i) => (
                <Line key={label} label={label} value={`${n}×`} last={i === insp.topFindings.length - 1} />
              ))}
              <Text style={st.hint}>From your latest {(data.recent || []).length} inspections.</Text>
            </Section>
          )}

          <Section title="Still ahead">
            <Line label="Last inspection" value={insp.last ? relativeTime(insp.last) : 'None yet'} />
            <Line label="Can be inspected" value={insp.dueCount} />
            <Line label="On hold (waiting for GSO)" value={insp.holdCount} last />
          </Section>
        </>
      )}

      {tech && (
        <>
          {stats && (
            <Section
              title={period === 'week' ? 'Jobs completed per day' : 'Jobs completed per week'}
              right={`${tech.doneInPeriod} total`}
            >
              <Columns items={tech.columns} />
            </Section>
          )}

          <Section title="Open jobs by priority" right={`${tech.assignedCount} open`}>
            <HBars items={tech.byPriority} empty="No open jobs." />
          </Section>

          <Section title="All my jobs">
            <SplitBar
              parts={[
                { label: 'Completed', value: tech.completed, color: C.green },
                { label: 'Awaiting GSO', value: tech.awaiting, color: C.grey },
                { label: 'To do', value: tech.assignedCount, color: C.red }
              ]}
            />
          </Section>

          <Section title="What you accomplished">
            <Line label="Last completed" value={tech.last ? relativeTime(tech.last) : 'None yet'} last />
            {(data.recent_done || []).slice(0, 5).map((r) => (
              <View key={r.id} style={st.doneRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.doneCode}>{r.equipment_code}</Text>
                  <Text style={st.doneMeta}>{r.description}</Text>
                  <Text style={st.doneMeta}>{relativeTime(r.completed_date)}</Text>
                </View>
                <View style={st.doneTag}>
                  <Text style={st.doneTagText}>Done</Text>
                </View>
              </View>
            ))}
          </Section>

          {(data.assigned || []).length > 0 && (
            <Section title="Waiting for you">
              {data.assigned.slice(0, 5).map((j, i, arr) => (
                <Line
                  key={j.id}
                  label={`${j.equipment_code} · ${TYPE_LABELS[j.equipment_type] || j.equipment_type}`}
                  value={REPAIR_STATUS_LABELS[j.repair_status] || j.repair_status}
                  last={i === arr.length - 1}
                />
              ))}
            </Section>
          )}
        </>
      )}

      {data && (
        <Pressable style={[st.btn, st.btnPrimary]} onPress={() => Share.share({ message: shareText() })}>
          <Text style={st.btnPrimaryText}>Share summary</Text>
        </Pressable>
      )}
      <Pressable style={[st.btn, st.btnGhost]} onPress={onBack}>
        <Text style={st.btnGhostText}>Back to dashboard</Text>
      </Pressable>
    </ScrollView>
  )
}

const st = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 40 },
  h1: { fontSize: 22, fontWeight: '800', color: C.text },
  sub: { fontSize: 13, color: C.muted, marginTop: 2, marginBottom: 14 },
  card: {
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 14
  },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  sectionRight: { fontSize: 12, color: C.muted },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.border
  },
  lineLabel: { fontSize: 14, color: C.muted, flexShrink: 1 },
  lineValue: { fontSize: 14, color: C.text, fontWeight: '700', textAlign: 'right' },
  hint: { fontSize: 12, color: C.muted, marginTop: 8 },

  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: C.white },
  chipOn: { backgroundColor: C.navy, borderColor: C.navy },
  chipText: { fontSize: 13, fontWeight: '600', color: C.muted },
  chipTextOn: { color: C.white },
  range: { fontSize: 12, color: C.muted, marginLeft: 'auto' },

  cols: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 112, borderBottomWidth: 1, borderBottomColor: C.border },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  colValue: { fontSize: 11, fontWeight: '700', color: C.text, marginBottom: 3 },
  colBar: { width: '100%', borderTopLeftRadius: 5, borderTopRightRadius: 5, overflow: 'hidden', flexDirection: 'column' },
  axis: { flexDirection: 'row', gap: 8, marginTop: 5 },
  axisLabel: { flex: 1, textAlign: 'center', fontSize: 10, color: C.muted },

  hbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 5 },
  hbLabel: { width: 104, fontSize: 12, color: C.text },
  hbTrack: { flex: 1, height: 9, borderRadius: 99, backgroundColor: C.border, overflow: 'hidden' },
  hbValue: { width: 24, textAlign: 'right', fontSize: 12, fontWeight: '700', color: C.text },

  splitRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  splitPct: { fontSize: 26, fontWeight: '800', color: C.text },
  split: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: C.border, marginTop: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendText: { fontSize: 12, color: C.muted },

  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: C.border
  },
  doneCode: { fontSize: 15, fontWeight: '700', color: C.text },
  doneMeta: { fontSize: 12, color: C.muted, marginTop: 1 },
  doneTag: { backgroundColor: C.greenBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  doneTagText: { fontSize: 12, fontWeight: '700', color: C.green },
  btn: { borderRadius: 10, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  btnPrimary: { backgroundColor: C.blue },
  btnPrimaryText: { color: C.white, fontSize: 16, fontWeight: '700' },
  btnGhost: { paddingVertical: 12 },
  btnGhostText: { color: C.muted, fontSize: 15, fontWeight: '600' }
})
