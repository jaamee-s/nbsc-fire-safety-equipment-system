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
  border: '#E3E8EF',
  text: '#1E293B',
  muted: '#64748B',
  white: '#FFFFFF'
}

function Tile({ value, label, color }) {
  return (
    <View style={st.tile}>
      <Text style={[st.tileValue, color && { color }]}>{value ?? 0}</Text>
      <Text style={st.tileLabel}>{label}</Text>
    </View>
  )
}

function Section({ title, children }) {
  return (
    <View style={st.card}>
      <Text style={st.sectionTitle}>{title}</Text>
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

function newest(list, key) {
  let best = null
  list.forEach((x) => {
    if (x[key] && (!best || new Date(x[key]) > new Date(best))) best = x[key]
  })
  return best
}

// Build everything the screen shows (and the shareable text) from the data
// the existing dashboard functions already return. No database change needed.
function buildInspectorSummary(data) {
  const recent = data.recent || []
  const bad = recent.filter((r) => r.condition_status === 'defective')
  const counts = {}
  bad.forEach((r) => {
    const f = (r.findings || 'Defective').trim()
    counts[f] = (counts[f] || 0) + 1
  })
  const topFindings = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  return {
    recentTotal: recent.length,
    recentOk: recent.length - bad.length,
    recentBad: bad.length,
    topFindings,
    dueCount: (data.due || []).length,
    holdCount: (data.on_hold || []).length,
    last: newest(recent, 'inspection_date')
  }
}

function buildTechnicianSummary(data) {
  const assigned = data.assigned || []
  const by = (p) => assigned.filter((j) => j.priority === p).length
  return {
    critical: by('critical'),
    high: by('high'),
    medium: by('medium'),
    low: by('low'),
    working: assigned.filter((j) => j.repair_status === 'working').length,
    notStarted: assigned.filter((j) => j.repair_status === 'assigned').length,
    last: newest(data.recent_done || [], 'completed_date')
  }
}

export default function SummaryScreen({ role, account, onBack }) {
  const isTech = role === 'technician'
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [generated, setGenerated] = useState(new Date())

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setError(null)
      try {
        setData(isTech ? await getTechnicianDashboard() : await getInspectorDashboard())
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

  const insp = data && !isTech ? buildInspectorSummary(data) : null
  const tech = data && isTech ? buildTechnicianSummary(data) : null

  function shareText() {
    if (!data) return ''
    const head = `FireSafety Tech&Inspect summary\n${account.full_name} (${isTech ? 'Technician' : 'Inspector'})\n${generated.toLocaleString()}\n`
    if (isTech) {
      return (
        head +
        `\nTo do: ${data.to_do_count ?? 0}\nAwaiting GSO: ${data.awaiting_gso_count ?? 0}\nCompleted: ${data.done_count ?? 0}\n` +
        `Critical: ${tech.critical} · High: ${tech.high} · Medium: ${tech.medium} · Low: ${tech.low}`
      )
    }
    return (
      head +
      `\nInspections today: ${data.today_count ?? 0}\nThis week: ${data.week_count ?? 0}\nDefects found: ${data.defect_count ?? 0}\n` +
      `Due for inspection: ${insp.dueCount}\nOn hold (waiting for GSO): ${insp.holdCount}`
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

      {insp && (
        <>
          <View style={st.tileRow}>
            <Tile value={data.today_count} label="Today" />
            <Tile value={data.week_count} label="This week" />
            <Tile value={data.defect_count} label="Defects found" color={data.defect_count > 0 ? C.red : undefined} />
          </View>

          <Section title="What you accomplished">
            <Line label="Last inspection" value={insp.last ? relativeTime(insp.last) : 'None yet'} />
            <Line label="Recent: functional" value={insp.recentOk} />
            <Line label="Recent: defective" value={insp.recentBad} last />
            <Text style={st.hint}>"Recent" covers the latest {insp.recentTotal} inspections on your dashboard.</Text>
          </Section>

          {insp.topFindings.length > 0 && (
            <Section title="Most reported problems">
              {insp.topFindings.map(([label, n], i) => (
                <Line key={label} label={label} value={`${n}×`} last={i === insp.topFindings.length - 1} />
              ))}
            </Section>
          )}

          <Section title="Still ahead">
            <Line label="Due for inspection" value={insp.dueCount} />
            <Line label="On hold (waiting for GSO)" value={insp.holdCount} last />
          </Section>
        </>
      )}

      {tech && (
        <>
          <View style={st.tileRow}>
            <Tile value={data.to_do_count} label="To do" color={data.to_do_count > 0 ? C.red : undefined} />
            <Tile value={data.awaiting_gso_count} label="Awaiting GSO" />
            <Tile value={data.done_count} label="Completed" color={C.green} />
          </View>

          <Section title="Your open jobs">
            <Line label="Not started" value={tech.notStarted} />
            <Line label="Working on it" value={tech.working} />
            <Line label="Critical" value={tech.critical} />
            <Line label="High" value={tech.high} />
            <Line label="Medium" value={tech.medium} />
            <Line label="Low" value={tech.low} last />
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
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  tile: {
    flex: 1,
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    alignItems: 'center'
  },
  tileValue: { fontSize: 24, fontWeight: '800', color: C.text },
  tileLabel: { fontSize: 11, color: C.muted, marginTop: 3, textAlign: 'center' },
  card: {
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 14
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 6 },
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