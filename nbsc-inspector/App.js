import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native'
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets
} from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'

import SummaryScreen from './SummaryScreen'
import {
  ACTION_TYPES,
  ACTION_TYPE_LABELS,
  FINDINGS_BY_TYPE,
  OPEN_PROBLEM_STATUSES,
  OTHER_FINDING,
  PRIORITY_OPTIONS,
  REPAIR_STATUS_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  daysUntil,
  findEquipmentByQrCode,
  getInspectorDashboard,
  getTechnicianDashboard,
  onSignedOut,
  relativeTime,
  restoreSession,
  signIn,
  signOut,
  submitInspection,
  updateRepairStatus
} from './lib/inspector'

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
  bg: '#F3F5F8',
  text: '#1E293B',
  muted: '#64748B',
  white: '#FFFFFF'
}

const PRIORITY_COLORS = {
  critical: { bg: '#FDEEEE', fg: '#B91C1C' },
  high: { bg: '#FFF1E6', fg: '#C2410C' },
  medium: { bg: '#FFF8E8', fg: '#B45309' },
  low: { bg: '#EAF1FF', fg: '#2563EB' }
}

// One confirmation helper for both the phone (Alert) and the web preview
// (Alert.alert does nothing in the browser).
function confirmAction(title, message, confirmText, onConfirm, destructive) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm()
    return
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: onConfirm }
  ])
}

// These only need to answer "does this fall in the same window the stat box
// counted?" — used purely to filter the already-fetched recent-inspections
// list for the tap-to-expand detail views, not to recompute the counts
// themselves (those come from the server, which knows the true totals).
function isToday(dateString) {
  if (!dateString) return false
  const d = new Date(dateString)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

function isThisWeek(dateString) {
  if (!dateString) return false
  const diffMs = new Date() - new Date(dateString)
  return diffMs >= 0 && diffMs <= 7 * 24 * 60 * 60 * 1000
}

// Keeps a dashboard fresh without the user pulling down: refreshes every
// 30 seconds and whenever the app comes back to the foreground. `load(true)`
// is a silent refresh (no error flash if the signal drops).
function useAutoRefresh(load, ms = 30000) {
  useEffect(() => {
    const id = setInterval(() => load(true), ms)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load(true)
    })
    return () => {
      clearInterval(id)
      sub.remove()
    }
  }, [load, ms])
}

export default function App() {
  return (
    <SafeAreaProvider>
      <RootApp />
    </SafeAreaProvider>
  )
}

function homeFor(role) {
  return role === 'technician' ? 'techHome' : 'home'
}

function RootApp() {
  // 'loading' | 'login' | 'home' (inspector) | 'techHome' | 'techJob' | 'summary'
  // | 'scan' | 'manual' | 'detail' | 'form' | 'done'
  const [screen, setScreen] = useState('loading')
  const [account, setAccount] = useState(null) // { id, full_name, role }
  const [equipment, setEquipment] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [job, setJob] = useState(null)

  useEffect(() => {
    restoreSession().then((acc) => {
      if (acc) {
        setAccount(acc)
        setScreen(homeFor(acc.role))
      } else {
        setScreen('login')
      }
    })
    // If the session ends (expired or revoked), go back to the login screen.
    return onSignedOut(() => {
      setAccount(null)
      setEquipment(null)
      setJob(null)
      setScreen('login')
    })
  }, [])

  function handleFound(item) {
    setEquipment(item)
    goToScreen('detail')
  }

  function goHome() {
    setEquipment(null)
    setLastResult(null)
    setJob(null)
    goToScreen(account ? homeFor(account.role) : 'login')
  }

  function handleLogout() {
    confirmAction('Log out', 'Sign out of this account on this phone?', 'Log out', async () => {
      await signOut()
      setAccount(null)
      setEquipment(null)
      setJob(null)
      setScreen('login')
    })
  }

  // The camera view is a special native surface that Android composites
  // outside React's normal render order. Swapping screens instantly can
  // leave a black "hole" from it briefly showing through the next screen.
  // Leaving a real gap — unmounting to null for one frame before mounting
  // the destination — gives Android time to release it cleanly.
  function goToScreen(next) {
    if (screen === 'scan') {
      setScreen(null)
      requestAnimationFrame(() => setScreen(next))
    } else {
      setScreen(next)
    }
  }

  // Android's hardware/gesture Back button steps back one screen instead of
  // closing the app, and only exits from a home screen or the login screen.
  useEffect(() => {
    const onBack = () => {
      if (screen === null) return true
      if (
        screen === 'scan' ||
        screen === 'manual' ||
        screen === 'detail' ||
        screen === 'done' ||
        screen === 'techJob' ||
        screen === 'summary'
      ) {
        goHome()
        return true
      }
      if (screen === 'form') {
        setScreen('detail')
        return true
      }
      return false
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack)
    return () => sub.remove()
  }, [screen, account])

  const roleLabel = account ? ROLE_LABELS[account.role] || account.role : ''

  return (
    <SafeAreaView key={screen} style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.navy} />

      {screen !== 'scan' && (
        <View style={s.header}>
          <View style={s.flex}>
            <Text style={s.headerTitle}>FireSafety Tech&Inspect</Text>
            <Text style={s.headerSub}>
              {account ? `${roleLabel}: ${account.full_name}` : 'NBSC Fire Safety Equipment'}
            </Text>
          </View>
          {account && screen !== 'loading' && screen !== 'login' && (
            <Pressable onPress={handleLogout} style={s.logoutBtn} hitSlop={8}>
              <Text style={s.logoutText}>Log out</Text>
            </Pressable>
          )}
        </View>
      )}

      {screen === null && <View style={s.center} />}

      {screen === 'loading' && (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.blue} />
        </View>
      )}

      {screen === 'login' && (
        <LoginScreen
          onSignedIn={(acc) => {
            setAccount(acc)
            setScreen(homeFor(acc.role))
          }}
        />
      )}

      {screen === 'home' && (
        <HomeScreen
          onScan={() => setScreen('scan')}
          onManual={() => setScreen('manual')}
          onOpenEquipment={handleFound}
          onSummary={() => setScreen('summary')}
        />
      )}

      {screen === 'techHome' && (
        <TechnicianHome
          onOpenJob={(j) => {
            setJob(j)
            setScreen('techJob')
          }}
          onSummary={() => setScreen('summary')}
        />
      )}

      {screen === 'summary' && account && (
        <SummaryScreen role={account.role} account={account} onBack={goHome} />
      )}

      {screen === 'techJob' && job && (
        <TechnicianJob job={job} onBack={goHome} onUpdated={goHome} />
      )}

      {screen === 'scan' && (
        <ScanScreen
          onFound={handleFound}
          onCancel={goHome}
          onManual={() => goToScreen('manual')}
        />
      )}

      {screen === 'manual' && <ManualEntry onFound={handleFound} onCancel={goHome} />}

      {screen === 'detail' && (
        <EquipmentDetail
          equipment={equipment}
          onInspect={() => setScreen('form')}
          onCancel={goHome}
        />
      )}

      {screen === 'form' && (
        <InspectionForm
          equipment={equipment}
          onSubmitted={(result) => {
            setLastResult(result)
            setScreen('done')
          }}
          onCancel={() => setScreen('detail')}
        />
      )}

      {screen === 'done' && (
        <DoneScreen
          result={lastResult}
          equipment={equipment}
          onNext={() => setScreen('scan')}
          onHome={goHome}
        />
      )}
    </SafeAreaView>
  )
}

/* ------------------------------------------------------------------ */
/* Login (inspector and technician accounts)                           */
/* ------------------------------------------------------------------ */

function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      onSignedIn(await signIn(email, password))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.h1}>Sign in</Text>
          <Text style={s.muted}>
            Use the account the GSO created for you. Inspectors scan and inspect equipment;
            technicians see and update their assigned repairs.
          </Text>

          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
          />

          <Text style={s.label}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showPassword}
            textContentType="password"
            onSubmitEditing={submit}
            returnKeyType="go"
          />
          <Pressable onPress={() => setShowPassword((v) => !v)}>
            <Text style={s.autoChange}>{showPassword ? 'Hide password' : 'Show password'}</Text>
          </Pressable>

          {error && <Text style={s.error}>{error}</Text>}

          <Pressable
            style={[s.btn, s.btnPrimary, (busy || !email.trim() || !password) && s.btnDisabled]}
            onPress={submit}
            disabled={busy || !email.trim() || !password}
          >
            <Text style={s.btnPrimaryText}>{busy ? 'Signing in...' : 'Sign in'}</Text>
          </Pressable>

          <Text style={[s.muted, { marginTop: 16, fontSize: 12 }]}>
            No account yet? Ask the General Services Office to create one for you.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/* ------------------------------------------------------------------ */
/* Inspector dashboard                                                 */
/* ------------------------------------------------------------------ */

function HomeScreen({ onScan, onManual, onOpenEquipment, onSummary }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  // Separate from `loading` so pull-to-refresh actually shows its spinner
  // while the reload runs (before, `loading` was never set back to true).
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  // Which stat box's detail list is currently open, if any.
  const [openStat, setOpenStat] = useState(null)

  // `silent` refreshes (auto-refresh) never flash an error if the signal drops.
  const load = useCallback(async (silent = false) => {
    if (!silent) setError(null)
    try {
      setData(await getInspectorDashboard())
      if (silent) setError(null)
    } catch (err) {
      if (!silent) setError(err.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useAutoRefresh(load)

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function openFromDue(code) {
    setError(null)
    try {
      onOpenEquipment(await findEquipmentByQrCode(code))
    } catch (err) {
      setError(err.message)
    }
  }

  // Retired units are never "due" for anything. The database function is
  // the real filter; this is a second guard so a retired unit can never
  // sit at the top of an inspector's to-do list even if the function lags.
  const dueList = ((data && data.due) || []).filter(
    (d) =>
      d.current_status !== 'no_longer_in_service' &&
      !OPEN_PROBLEM_STATUSES.includes(d.current_status)
  )
  const onHoldList = (data && data.on_hold) || []

  return (
    <ScrollView
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Pressable style={s.scanCta} onPress={onScan}>
        <Text style={s.scanCtaIcon}>▣</Text>
        <Text style={s.scanCtaText}>Scan QR Code</Text>
        <Text style={s.scanCtaSub}>Point the camera at the sticker</Text>
      </Pressable>

      <Pressable style={[s.btn, s.btnOutline]} onPress={onManual}>
        <Text style={s.btnOutlineText}>Enter code manually</Text>
      </Pressable>

      <Pressable style={[s.btn, s.btnOutline]} onPress={onSummary}>
        <Text style={s.btnOutlineText}>📊 My Summary</Text>
      </Pressable>

      {error && (
        <View style={[s.card, { marginTop: 14 }]}>
          <Text style={s.error}>{error}</Text>
        </View>
      )}

      {loading && !data ? (
        <View style={[s.card, s.centerPad, { marginTop: 18 }]}>
          <ActivityIndicator color={C.blue} />
        </View>
      ) : data ? (
        <>
          <View style={s.statRow}>
            <Stat
              value={data.today_count}
              label="Today"
              active={openStat === 'today'}
              onPress={() => setOpenStat(openStat === 'today' ? null : 'today')}
            />
            <Stat
              value={data.week_count}
              label="This week"
              active={openStat === 'week'}
              onPress={() => setOpenStat(openStat === 'week' ? null : 'week')}
            />
            <Stat
              value={data.defect_count}
              label="Defects found"
              alert
              active={openStat === 'defects'}
              onPress={() => setOpenStat(openStat === 'defects' ? null : 'defects')}
            />
          </View>

          {openStat &&
            (() => {
              const recent = data.recent || []
              const filtered =
                openStat === 'today'
                  ? recent.filter((r) => isToday(r.inspection_date))
                  : openStat === 'week'
                  ? recent.filter((r) => isThisWeek(r.inspection_date))
                  : recent.filter((r) => r.condition_status === 'defective')

              const totalForStat =
                openStat === 'today'
                  ? data.today_count
                  : openStat === 'week'
                  ? data.week_count
                  : data.defect_count

              const titleMap = {
                today: "Today's inspections",
                week: "This week's inspections",
                defects: 'Defects found'
              }

              return (
                <View style={[s.card, { marginBottom: 20 }]}>
                  <View style={s.statPanelHead}>
                    <Text style={s.sectionTitle}>{titleMap[openStat]}</Text>
                    <Pressable onPress={() => setOpenStat(null)}>
                      <Text style={s.statPanelClose}>Close</Text>
                    </Pressable>
                  </View>

                  {filtered.length === 0 ? (
                    <Text style={s.muted}>
                      {totalForStat > 0
                        ? "None of these are in your recent list — check your full inspection history."
                        : 'Nothing here yet.'}
                    </Text>
                  ) : (
                    filtered.map((r, i) => {
                      const bad = r.condition_status === 'defective'
                      return (
                        <View
                          key={r.id}
                          style={[s.listRow, i === filtered.length - 1 && s.listRowLast]}
                        >
                          <View style={s.flex}>
                            <Text style={s.listCode}>{r.equipment_code}</Text>
                            <Text style={s.listMeta}>
                              {bad ? r.findings || 'Defective' : 'Functional'}
                            </Text>
                            <Text style={s.listMeta}>{relativeTime(r.inspection_date)}</Text>
                          </View>
                          <View style={[s.tag, bad ? s.tagRed : s.tagGreen]}>
                            <Text style={[s.tagText, { color: bad ? C.red : C.green }]}>
                              {bad ? 'Defective' : 'OK'}
                            </Text>
                          </View>
                        </View>
                      )
                    })
                  )}

                  {totalForStat > filtered.length && (
                    <Text style={[s.sectionHint, { marginTop: 8, marginBottom: 0 }]}>
                      Showing your most recent — the full count ({totalForStat}) may include
                      older entries not listed here.
                    </Text>
                  )}
                </View>
              )
            })()}

          <Text style={s.sectionTitle}>Due for inspection</Text>
          <Text style={s.sectionHint}>Longest since last check — start here.</Text>
          <View style={s.card}>
            {dueList.length === 0 ? (
              <Text style={s.muted}>Nothing due right now.</Text>
            ) : (
              dueList.map((d, i) => {
                const needsAttention = d.current_status && d.current_status !== 'functional'
                return (
                  <Pressable
                    key={d.id}
                    style={[s.listRow, i === dueList.length - 1 && s.listRowLast]}
                    onPress={() => openFromDue(d.equipment_code)}
                  >
                    <View style={s.flex}>
                      <Text style={s.listCode}>{d.equipment_code}</Text>
                      <Text style={s.listMeta}>
                        {TYPE_LABELS[d.equipment_type] || d.equipment_type}
                        {d.building_name ? ` · ${d.building_name}` : ''}
                      </Text>
                      <Text style={s.listMeta}>{d.exact_location}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text
                        style={[
                          s.listWhen,
                          !d.last_inspected && { color: C.red, fontWeight: '700' }
                        ]}
                      >
                        {relativeTime(d.last_inspected)}
                      </Text>
                      {needsAttention && (
                        <View style={[s.tag, s.tagRed]}>
                          <Text style={[s.tagText, { color: C.red }]}>
                            {STATUS_LABELS[d.current_status] || d.current_status}
                          </Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                )
              })
            )}
          </View>

          {onHoldList.length > 0 && (
            <>
              <Text style={s.sectionTitle}>On hold — waiting for GSO</Text>
              <Text style={s.sectionHint}>
                A defect was reported on these. They can be inspected again once GSO records the outcome.
              </Text>
              <View style={s.card}>
                {onHoldList.map((d, i) => (
                  <Pressable
                    key={d.id}
                    style={[s.listRow, i === onHoldList.length - 1 && s.listRowLast]}
                    onPress={() => openFromDue(d.equipment_code)}
                  >
                    <View style={s.flex}>
                      <Text style={s.listCode}>{d.equipment_code}</Text>
                      <Text style={s.listMeta}>
                        {TYPE_LABELS[d.equipment_type] || d.equipment_type}
                        {d.building_name ? ` · ${d.building_name}` : ''}
                      </Text>
                      <Text style={s.listMeta}>{d.exact_location}</Text>
                    </View>
                    <View style={[s.tag, s.tagRed]}>
                      <Text style={[s.tagText, { color: C.red }]}>
                        {STATUS_LABELS[d.current_status] || d.current_status}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={s.sectionTitle}>Your recent inspections</Text>
          <View style={[s.card, { marginTop: 8 }]}>
            {(data.recent || []).length === 0 ? (
              <Text style={s.muted}>Nothing submitted yet.</Text>
            ) : (
              data.recent.map((r, i) => {
                const bad = r.condition_status === 'defective'
                return (
                  <View
                    key={r.id}
                    style={[s.listRow, i === data.recent.length - 1 && s.listRowLast]}
                  >
                    <View style={s.flex}>
                      <Text style={s.listCode}>{r.equipment_code}</Text>
                      <Text style={s.listMeta}>
                        {bad ? r.findings || 'Defective' : 'Functional'}
                      </Text>
                      <Text style={s.listMeta}>{relativeTime(r.inspection_date)}</Text>
                    </View>
                    <View style={[s.tag, bad ? s.tagRed : s.tagGreen]}>
                      <Text style={[s.tagText, { color: bad ? C.red : C.green }]}>
                        {bad ? 'Defective' : 'OK'}
                      </Text>
                    </View>
                  </View>
                )
              })
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}

function Stat({ value, label, alert, active, onPress }) {
  return (
    <Pressable style={[s.stat, active && s.statActive]} onPress={onPress}>
      <Text style={[s.statValue, alert && value > 0 && { color: C.red }]}>
        {value ?? 0}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
    </Pressable>
  )
}

/* ------------------------------------------------------------------ */
/* Technician dashboard and job                                        */
/* ------------------------------------------------------------------ */

function PriorityTag({ priority }) {
  const c = PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium
  return (
    <View style={[s.tag, { backgroundColor: c.bg }]}>
      <Text style={[s.tagText, { color: c.fg }]}>
        {(priority || 'medium').charAt(0).toUpperCase() + (priority || 'medium').slice(1)}
      </Text>
    </View>
  )
}

function TechnicianHome({ onOpenJob, onSummary }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setError(null)
    try {
      setData(await getTechnicianDashboard())
      if (silent) setError(null)
    } catch (err) {
      if (!silent) setError(err.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useAutoRefresh(load)

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const jobs = (data && data.assigned) || []

  return (
    <ScrollView
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {error && (
        <View style={s.card}>
          <Text style={s.error}>{error}</Text>
        </View>
      )}

      {loading && !data ? (
        <View style={[s.card, s.centerPad]}>
          <ActivityIndicator color={C.blue} />
        </View>
      ) : data ? (
        <>
          <View style={[s.statRow, { marginTop: 0 }]}>
            <Stat value={data.to_do_count} label="To do" alert />
            <Stat value={data.awaiting_gso_count} label="Awaiting GSO" />
            <Stat value={data.done_count} label="Completed" />
          </View>

          <Pressable
            style={[s.btn, s.btnOutline, { marginTop: 0, marginBottom: 18 }]}
            onPress={onSummary}
          >
            <Text style={s.btnOutlineText}>📊 My Summary</Text>
          </Pressable>

          <Text style={s.sectionTitle}>Assigned to you</Text>
          <Text style={s.sectionHint}>Highest priority first. Tap a job to open it.</Text>
          <View style={s.card}>
            {jobs.length === 0 ? (
              <Text style={s.muted}>No repairs assigned right now. Pull down to refresh.</Text>
            ) : (
              jobs.map((j, i) => (
                <Pressable
                  key={j.id}
                  style={[s.listRow, i === jobs.length - 1 && s.listRowLast]}
                  onPress={() => onOpenJob(j)}
                >
                  <View style={s.flex}>
                    <Text style={s.listCode}>{j.equipment_code}</Text>
                    <Text style={s.listMeta}>
                      {TYPE_LABELS[j.equipment_type] || j.equipment_type}
                      {j.building_name ? ` · ${j.building_name}` : ''}
                    </Text>
                    <Text style={s.listMeta}>{j.exact_location}</Text>
                    <Text style={[s.listMeta, { color: C.text }]}>{j.description}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <PriorityTag priority={j.priority} />
                    <Text style={s.listWhen}>
                      {REPAIR_STATUS_LABELS[j.repair_status] || j.repair_status}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>

          <Text style={s.sectionTitle}>Recently completed</Text>
          <View style={[s.card, { marginTop: 8 }]}>
            {(data.recent_done || []).length === 0 ? (
              <Text style={s.muted}>Nothing completed yet.</Text>
            ) : (
              data.recent_done.map((r, i) => (
                <View
                  key={r.id}
                  style={[s.listRow, i === data.recent_done.length - 1 && s.listRowLast]}
                >
                  <View style={s.flex}>
                    <Text style={s.listCode}>{r.equipment_code}</Text>
                    <Text style={s.listMeta}>{r.description}</Text>
                    <Text style={s.listMeta}>{relativeTime(r.completed_date)}</Text>
                  </View>
                  <View style={[s.tag, s.tagGreen]}>
                    <Text style={[s.tagText, { color: C.green }]}>Done</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}

function TechnicianJob({ job, onBack, onUpdated }) {
  const [note, setNote] = useState(job.repair_note || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const repaired = job.repair_status === 'repaired'
  const working = job.repair_status === 'working'

  async function apply(status) {
    setError(null)
    setSaving(true)
    try {
      await updateRepairStatus(job.id, status, note)
      onUpdated()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  function markRepaired() {
    confirmAction(
      'Mark as repaired?',
      `Confirm that ${job.equipment_code} has been repaired. GSO will be notified and will verify the unit before closing the job.`,
      'Mark repaired',
      () => apply('repaired')
    )
  }

  return (
    <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <Text style={s.code}>{job.equipment_code}</Text>
        <Text style={s.type}>{TYPE_LABELS[job.equipment_type] || job.equipment_type}</Text>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
          <PriorityTag priority={job.priority} />
          <View style={[s.tag, repaired ? s.tagGreen : { backgroundColor: C.blueBg }]}>
            <Text style={[s.tagText, { color: repaired ? C.green : C.blue }]}>
              {REPAIR_STATUS_LABELS[job.repair_status] || job.repair_status}
            </Text>
          </View>
        </View>

        <Row label="Building" value={job.building_name ?? '—'} />
        <Row label="Location" value={job.exact_location ?? '—'} />
        <Row label="Problem" value={job.description} />
        <Row label="Work type" value={ACTION_TYPE_LABELS[job.action_type] || job.action_type} />
        {job.job_order_remarks ? <Row label="GSO notes" value={job.job_order_remarks} /> : null}
        {job.decided_at ? <Row label="Job order" value={relativeTime(job.decided_at)} /> : null}

        {repaired && (
          <View style={[s.banner, s.bannerGreen]}>
            <Text style={s.bannerGreenText}>
              Marked as repaired. Waiting for GSO to verify the unit and close the job.
            </Text>
          </View>
        )}

        <Text style={s.label}>Note for GSO (optional)</Text>
        <TextInput
          style={[s.input, s.textarea]}
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Replaced the battery and tested the unit"
          multiline
        />

        {error && <Text style={s.error}>{error}</Text>}

        {!repaired && !working && (
          <Pressable
            style={[s.btn, s.btnOutline, saving && s.btnDisabled]}
            onPress={() => apply('working')}
            disabled={saving}
          >
            <Text style={s.btnOutlineText}>Start working</Text>
          </Pressable>
        )}

        {!repaired ? (
          <Pressable
            style={[s.btn, { backgroundColor: C.green }, saving && s.btnDisabled]}
            onPress={markRepaired}
            disabled={saving}
          >
            <Text style={s.btnPrimaryText}>{saving ? 'Saving...' : 'Mark as repaired'}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[s.btn, s.btnOutline, saving && s.btnDisabled]}
            onPress={() => apply('working')}
            disabled={saving}
          >
            <Text style={s.btnOutlineText}>Not fixed yet — back to working</Text>
          </Pressable>
        )}

        <Pressable style={[s.btn, s.btnGhost]} onPress={onBack} disabled={saving}>
          <Text style={s.btnGhostText}>Back</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

/* ------------------------------------------------------------------ */
/* Camera scanner                                                      */
/* ------------------------------------------------------------------ */

function ScanScreen({ onFound, onCancel, onManual }) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const [footerHeight, setFooterHeight] = useState(0)
  const [permission, requestPermission] = useCameraPermissions()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [cameraError, setCameraError] = useState(null)
  const [cameraReady, setCameraReady] = useState(false)
  // True the instant the user is leaving this screen. CameraView stops
  // rendering (and its native camera session starts closing) right away —
  // the delay below just gives that real teardown time to finish before
  // the app moves to the next screen, which is what actually prevents the
  // leftover black surface from bleeding into whatever renders next.
  const [closing, setClosing] = useState(false)

  function leave(action) {
    if (closing) return
    setClosing(true)
    setTimeout(action, 350)
  }

  // Before the footer has measured itself, estimate; once it reports its
  // real height via onLayout below, this becomes exact. Either way it's a
  // real number, not a flex percentage — that's what fixes the sizing bug.
  const cameraAreaHeight =
    footerHeight > 0 ? windowHeight - footerHeight : Math.round(windowHeight * 0.72)

  // The camera fires this repeatedly while a code is in frame, so `busy`
  // guards against firing a dozen lookups for one sticker.
  async function handleScan({ data }) {
    if (busy || closing) return
    setBusy(true)
    setError(null)
    try {
      const item = await findEquipmentByQrCode(data)
      leave(() => onFound(item))
    } catch (err) {
      setError(err.message)
      setTimeout(() => setBusy(false), 1500)
    }
  }

  if (!permission) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={C.blue} />
      </View>
    )
  }

  if (!permission.granted) {
    // If the user chose "Don't ask again", requestPermission() silently does
    // nothing, which left the old "Allow Camera" button dead. In that case
    // the only way forward is the phone's own app settings.
    const blocked = permission.canAskAgain === false

    return (
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 16 }]}
      >
        <View style={s.card}>
          <Text style={s.h1}>Camera access needed</Text>
          <Text style={s.muted}>
            The app uses the camera only to read equipment QR stickers. No photos are
            taken or uploaded.
            {blocked
              ? ' Camera access was turned off for this app, so it has to be re-enabled in the phone\'s settings.'
              : ''}
          </Text>
          {blocked ? (
            <Pressable style={[s.btn, s.btnPrimary]} onPress={() => Linking.openSettings()}>
              <Text style={s.btnPrimaryText}>Open Settings</Text>
            </Pressable>
          ) : (
            <Pressable style={[s.btn, s.btnPrimary]} onPress={requestPermission}>
              <Text style={s.btnPrimaryText}>Allow Camera</Text>
            </Pressable>
          )}
          <Pressable style={[s.btn, s.btnOutline]} onPress={onManual}>
            <Text style={s.btnOutlineText}>Enter code manually instead</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnGhost]} onPress={onCancel}>
            <Text style={s.btnGhostText}>Back</Text>
          </Pressable>
        </View>
      </ScrollView>
    )
  }

  if (closing) {
    return (
      <View style={s.scanWrap}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.white} />
          <Text style={[s.scanHint, { marginTop: 14 }]}>Closing camera...</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={s.scanWrap}>
      <View style={[s.cameraArea, { height: cameraAreaHeight }]}>
        <CameraView
          style={{ width: '100%', height: cameraAreaHeight }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={busy ? undefined : handleScan}
          onCameraReady={() => setCameraReady(true)}
          onMountError={(e) =>
            setCameraError(e?.message || 'Camera failed to start on this device.')
          }
        />

        <View
          style={[s.scanCenterColumn, { height: cameraAreaHeight }]}
          pointerEvents="none"
        >
          <View style={s.scanFrame} />
          <Text style={s.scanHint}>
            {cameraError
              ? 'Camera unavailable'
              : !cameraReady
              ? 'Starting camera...'
              : busy
              ? 'Looking up...'
              : 'Line up the QR sticker'}
          </Text>
        </View>

        {cameraError && (
          <View style={s.cameraErrorBanner} pointerEvents="none">
            <Text style={s.cameraErrorText}>{cameraError}</Text>
            <Text style={s.cameraErrorHint}>
              On some phones, camera access must also be allowed in the phone's
              Security or Privacy settings, separate from this app's permission
              prompt. Use "Enter code manually" below in the meantime.
            </Text>
          </View>
        )}
      </View>

      <View
        style={[s.scanFooter, { paddingBottom: insets.bottom + 18 }]}
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
      >
        {error && <Text style={s.scanError}>{error}</Text>}
        <Pressable style={[s.btn, s.btnOutlineLight]} onPress={() => leave(onManual)}>
          <Text style={s.btnOutlineLightText}>Enter code manually</Text>
        </Pressable>
        <Pressable style={[s.btn, s.btnGhost]} onPress={() => leave(onCancel)}>
          <Text style={[s.btnGhostText, { color: C.white }]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

/* ------------------------------------------------------------------ */
/* Manual code entry — permanent fallback, not a stopgap               */
/* ------------------------------------------------------------------ */

function ManualEntry({ onFound, onCancel }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [looking, setLooking] = useState(false)

  async function lookup() {
    setError(null)
    setLooking(true)
    try {
      onFound(await findEquipmentByQrCode(code))
    } catch (err) {
      setError(err.message)
    }
    setLooking(false)
  }

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.card}>
          <Text style={s.h1}>Enter code</Text>
          <Text style={s.muted}>
            Type the code printed under the QR sticker. Use this when a sticker is
            scratched, faded or painted over.
          </Text>

          <TextInput
            style={[s.input, s.inputCode, { marginTop: 16 }]}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="FE-001"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={() => code.trim() && lookup()}
            returnKeyType="search"
          />

          {error && <Text style={s.error}>{error}</Text>}

          <Pressable
            style={[s.btn, s.btnPrimary, (looking || !code.trim()) && s.btnDisabled]}
            onPress={lookup}
            disabled={looking || !code.trim()}
          >
            <Text style={s.btnPrimaryText}>
              {looking ? 'Looking up...' : 'Find Equipment'}
            </Text>
          </Pressable>

          <Pressable style={[s.btn, s.btnGhost]} onPress={onCancel}>
            <Text style={s.btnGhostText}>Back</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/* ------------------------------------------------------------------ */
/* What the scan reveals                                               */
/* ------------------------------------------------------------------ */

function EquipmentDetail({ equipment, onInspect, onCancel }) {
  const left = daysUntil(equipment.expiration_date)
  // Permanently retired equipment has nothing left to inspect — a disposed
  // fire extinguisher is physically gone, and anything else in this state
  // was already confirmed beyond repair. Blocking here also prevents a
  // stray inspection from silently reviving a status GSO deliberately set.
  const isRetired = equipment.current_status === 'no_longer_in_service'
  // An expiry warning on a unit that's already been retired is noise.
  const expired = !isRetired && left !== null && left < 0
  const expiringSoon = !isRetired && left !== null && left >= 0 && left <= 30
  const isFunctional = equipment.current_status === 'functional'
  // A reported defect must be handled by GSO first. Until GSO records the
  // outcome and the unit is Functional again, inspection stays on hold.
  const onHold = OPEN_PROBLEM_STATUSES.includes(equipment.current_status)

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <View style={s.card}>
        <Text style={s.code}>{equipment.equipment_code}</Text>
        <Text style={s.type}>
          {TYPE_LABELS[equipment.equipment_type] || equipment.equipment_type}
        </Text>

        <View style={[s.pill, isFunctional ? s.pillGreen : s.pillRed]}>
          <Text style={[s.pillText, { color: isFunctional ? C.green : C.red }]}>
            {STATUS_LABELS[equipment.current_status] || equipment.current_status}
          </Text>
        </View>

        <Row label="Building" value={equipment.buildings?.building_name ?? '—'} />
        <Row label="Location" value={equipment.exact_location ?? '—'} />
        <Row label="Expiration" value={equipment.expiration_date ?? 'Not applicable'} />
        {equipment.description ? <Row label="Notes" value={equipment.description} /> : null}

        {expired && (
          <View style={[s.banner, s.bannerRed]}>
            <Text style={s.bannerRedText}>
              Expired {Math.abs(left)} day{Math.abs(left) === 1 ? '' : 's'} ago.
            </Text>
          </View>
        )}
        {expiringSoon && (
          <View style={[s.banner, s.bannerAmber]}>
            <Text style={s.bannerAmberText}>
              {left === 0 ? 'Expires today.' : `Expires in ${left} days.`}
            </Text>
          </View>
        )}

        {onHold && !isRetired && (
          <View style={[s.banner, s.bannerAmber]}>
            <Text style={s.bannerAmberText}>
              Inspection is on hold. A defect was reported on this unit and GSO has not
              recorded the outcome yet. It can be inspected again once it is back to Functional.
            </Text>
          </View>
        )}

        {isRetired ? (
          <View style={[s.banner, s.bannerRed, { marginTop: 16 }]}>
            <Text style={s.bannerRedText}>
              This equipment has been retired and is no longer in service.
            </Text>
          </View>
        ) : (
          <Pressable
            style={[s.btn, s.btnPrimary, onHold && s.btnDisabled]}
            onPress={onInspect}
            disabled={onHold}
          >
            <Text style={s.btnPrimaryText}>Start Inspection</Text>
          </Pressable>
        )}

        <Pressable style={[s.btn, s.btnGhost]} onPress={onCancel}>
          <Text style={s.btnGhostText}>Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

function Row({ label, value }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  )
}

/* ------------------------------------------------------------------ */
/* The inspection itself                                               */
/* ------------------------------------------------------------------ */

function InspectionForm({ equipment, onSubmitted, onCancel }) {
  const presets = FINDINGS_BY_TYPE[equipment.equipment_type] || []

  const [condition, setCondition] = useState(null)
  const [selectedFinding, setSelectedFinding] = useState(null)
  const [otherText, setOtherText] = useState('')
  const [notes, setNotes] = useState('')
  const [actionType, setActionType] = useState('other')
  const [priority, setPriority] = useState('medium')
  const [showOverrides, setShowOverrides] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const defective = condition === 'defective'
  const isOther = selectedFinding === OTHER_FINDING

  // Choosing a finding sets what it implies. Both stay overridable, but the
  // override rows stay collapsed so the fast path is: finding, submit.
  function pickFinding(preset) {
    setSelectedFinding(preset.label)
    setActionType(preset.action)
    setPriority(preset.priority)
    setShowOverrides(false)
  }

  const findingsText = isOther ? otherText : selectedFinding || ''
  const canSubmit = condition === 'functional' || (defective && findingsText.trim())

  async function submit() {
    setError(null)
    setSaving(true)
    try {
      await submitInspection({
        equipmentId: equipment.id,
        conditionStatus: condition,
        // Only a defective inspection carries findings. Before, tapping
        // Defective, picking a finding, then switching to Functional still
        // submitted that finding — so GSO's history showed a "Functional"
        // inspection with "Gauge in red zone" under it.
        findings: defective ? findingsText : '',
        inspectionNotes: notes,
        actionType,
        priority
      })
      onSubmitted({ condition })
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.h1}>{equipment.equipment_code}</Text>
          <Text style={s.muted}>
            {equipment.buildings?.building_name} · {equipment.exact_location}
          </Text>

          <Text style={s.label}>Condition</Text>
          <View style={s.choiceRow}>
            <Pressable
              style={[s.choice, condition === 'functional' && s.choiceGreen]}
              onPress={() => setCondition('functional')}
            >
              <Text style={[s.choiceText, condition === 'functional' && s.choiceTextActive]}>
                Functional
              </Text>
            </Pressable>
            <Pressable
              style={[s.choice, defective && s.choiceRed]}
              onPress={() => setCondition('defective')}
            >
              <Text style={[s.choiceText, defective && s.choiceTextActive]}>Defective</Text>
            </Pressable>
          </View>

          {defective && (
            <>
              <Text style={s.label}>What is wrong?</Text>
              <View style={s.findingWrap}>
                {presets.map((p) => {
                  const active = selectedFinding === p.label
                  return (
                    <Pressable
                      key={p.label}
                      style={[s.finding, active && s.findingActive]}
                      onPress={() => pickFinding(p)}
                    >
                      <Text style={[s.findingText, active && s.findingTextActive]}>
                        {p.label}
                      </Text>
                    </Pressable>
                  )
                })}
                <Pressable
                  style={[s.finding, isOther && s.findingActive]}
                  onPress={() => setSelectedFinding(OTHER_FINDING)}
                >
                  <Text style={[s.findingText, isOther && s.findingTextActive]}>
                    Something else...
                  </Text>
                </Pressable>
              </View>

              {isOther && (
                <TextInput
                  style={[s.input, s.textarea, { marginTop: 10 }]}
                  value={otherText}
                  onChangeText={setOtherText}
                  placeholder="Describe what you found"
                  multiline
                  autoFocus
                />
              )}

              <Text style={s.label}>Action required</Text>
              <View style={s.autoBox}>
                <View style={s.autoRow}>
                  <Text style={s.autoLabel}>Action</Text>
                  <Text style={s.autoValue}>{ACTION_TYPE_LABELS[actionType]}</Text>
                </View>
                <View style={[s.autoRow, { borderBottomWidth: 0 }]}>
                  <Text style={s.autoLabel}>Priority</Text>
                  <Text
                    style={[
                      s.autoValue,
                      (priority === 'critical' || priority === 'high') && { color: C.red }
                    ]}
                  >
                    {priority.charAt(0).toUpperCase() + priority.slice(1)}
                  </Text>
                </View>
                <Pressable onPress={() => setShowOverrides((v) => !v)}>
                  <Text style={s.autoChange}>
                    {showOverrides ? 'Done' : 'Set automatically · Change'}
                  </Text>
                </Pressable>
              </View>

              {showOverrides && (
                <>
                  <Text style={s.label}>Action type</Text>
                  <View style={s.chipWrap}>
                    {ACTION_TYPES.map((t) => (
                      <Pressable
                        key={t}
                        style={[s.chip, actionType === t && s.chipActive]}
                        onPress={() => setActionType(t)}
                      >
                        <Text style={[s.chipText, actionType === t && s.chipTextActive]}>
                          {ACTION_TYPE_LABELS[t]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={s.label}>Priority</Text>
                  <View style={s.chipWrap}>
                    {PRIORITY_OPTIONS.map((p) => (
                      <Pressable
                        key={p}
                        style={[s.chip, priority === p && s.chipActive]}
                        onPress={() => setPriority(p)}
                      >
                        <Text style={[s.chipText, priority === p && s.chipTextActive]}>
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          <Text style={s.label}>Notes (optional)</Text>
          <TextInput
            style={[s.input, s.textarea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else worth recording"
            multiline
          />

          {error && <Text style={s.error}>{error}</Text>}

          <Pressable
            style={[s.btn, s.btnPrimary, (saving || !canSubmit) && s.btnDisabled]}
            onPress={submit}
            disabled={saving || !canSubmit}
          >
            <Text style={s.btnPrimaryText}>
              {saving ? 'Submitting...' : 'Submit Inspection'}
            </Text>
          </Pressable>

          <Pressable style={[s.btn, s.btnGhost]} onPress={onCancel} disabled={saving}>
            <Text style={s.btnGhostText}>Back</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/* ------------------------------------------------------------------ */
/* Confirmation                                                        */
/* ------------------------------------------------------------------ */

function DoneScreen({ result, equipment, onNext, onHome }) {
  const defective = result?.condition === 'defective'

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <View style={s.card}>
        <Text style={s.h1}>Inspection recorded</Text>
        <Text style={s.muted}>
          {equipment?.equipment_code} was marked{' '}
          <Text style={{ fontWeight: '700' }}>
            {defective ? 'defective' : 'functional'}
          </Text>
          .
        </Text>

        <View style={[s.banner, defective ? s.bannerAmber : s.bannerGreen]}>
          <Text style={defective ? s.bannerAmberText : s.bannerGreenText}>
            {defective
              ? 'GSO has been notified. This unit now appears in their Priority Actions, and it cannot be inspected again until GSO resolves it.'
              : 'No action needed. The unit is marked Functional.'}
          </Text>
        </View>

        <Pressable style={[s.btn, s.btnPrimary]} onPress={onNext}>
          <Text style={s.btnPrimaryText}>Scan Next</Text>
        </Pressable>

        <Pressable style={[s.btn, s.btnGhost]} onPress={onHome}>
          <Text style={s.btnGhostText}>Back to dashboard</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

/* ------------------------------------------------------------------ */

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerPad: { alignItems: 'center', paddingVertical: 26 },
  scroll: { padding: 16, paddingBottom: 40 },

  header: {
    backgroundColor: C.navy,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  logoutBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  logoutText: { color: C.white, fontSize: 12, fontWeight: '700' },
  headerTitle: { color: C.white, fontSize: 18, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },

  card: {
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginBottom: 14
  },

  h1: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 6 },
  muted: { fontSize: 14, color: C.muted, lineHeight: 20 },

  code: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: 0.5 },
  type: { fontSize: 15, color: C.muted, marginTop: 2, marginBottom: 10 },

  label: {
    fontSize: 13,
    fontWeight: '700',
    color: C.muted,
    marginTop: 18,
    marginBottom: 6
  },

  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 2 },
  sectionHint: { fontSize: 12, color: C.muted, marginBottom: 8 },

  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: C.text,
    backgroundColor: C.white
  },
  inputCode: { fontSize: 24, fontWeight: '700', letterSpacing: 2, textAlign: 'center' },
  textarea: { minHeight: 78, textAlignVertical: 'top' },

  error: { color: C.red, fontSize: 14, marginTop: 12 },

  btn: { borderRadius: 10, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  btnPrimary: { backgroundColor: C.blue },
  btnPrimaryText: { color: C.white, fontSize: 16, fontWeight: '700' },
  btnOutline: { borderWidth: 1, borderColor: C.border, backgroundColor: C.white },
  btnOutlineText: { color: C.text, fontSize: 15, fontWeight: '600' },
  btnOutlineLight: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  btnOutlineLightText: { color: C.white, fontSize: 15, fontWeight: '600' },
  btnGhost: { backgroundColor: 'transparent', paddingVertical: 12, marginTop: 4 },
  btnGhostText: { color: C.muted, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },

  /* dashboard */
  scanCta: {
    backgroundColor: C.navy,
    borderRadius: 14,
    paddingVertical: 30,
    alignItems: 'center',
    marginBottom: 12
  },
  scanCtaIcon: { fontSize: 34, color: C.white, marginBottom: 6 },
  scanCtaText: { color: C.white, fontSize: 19, fontWeight: '700' },
  scanCtaSub: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 3 },

  statRow: { flexDirection: 'row', gap: 10, marginTop: 18, marginBottom: 20 },
  stat: {
    flex: 1,
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    alignItems: 'center'
  },
  statValue: { fontSize: 24, fontWeight: '800', color: C.text },
  statLabel: { fontSize: 11, color: C.muted, marginTop: 3, textAlign: 'center' },
  statActive: { borderColor: C.blue, borderWidth: 2, backgroundColor: C.blueBg },

  statPanelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  statPanelClose: { fontSize: 13, color: C.blue, fontWeight: '600' },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12
  },
  listRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  listCode: { fontSize: 15, fontWeight: '700', color: C.text },
  listMeta: { fontSize: 12, color: C.muted, marginTop: 1 },
  listWhen: { fontSize: 12, color: C.muted, textAlign: 'right' },

  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagGreen: { backgroundColor: C.greenBg },
  tagRed: { backgroundColor: C.redBg },
  tagText: { fontSize: 12, fontWeight: '700' },

  /* scanner */
  scanWrap: { flex: 1, backgroundColor: '#000' },
  // Height is now set explicitly per-render (see ScanScreen), computed from
  // real measured pixels rather than flex — some Android chipsets get the
  // camera's SurfaceView stuck at an early small size when it's sized only
  // by flex/percentage, so an explicit number forces a correct resize.
  cameraArea: { position: 'relative', width: '100%' },
  scanCenterColumn: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2
  },
  scanFrame: {
    width: 230,
    height: 230,
    borderWidth: 3,
    borderColor: C.white,
    borderRadius: 18,
    backgroundColor: 'transparent'
  },
  scanHint: { color: C.white, fontSize: 15, fontWeight: '600', marginTop: 18 },
  scanFooter: { padding: 18, backgroundColor: '#000' },
  scanError: { color: '#FCA5A5', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  cameraErrorBanner: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    backgroundColor: 'rgba(185,28,28,0.92)',
    borderRadius: 10,
    padding: 14,
    zIndex: 3
  },
  cameraErrorText: { color: C.white, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  cameraErrorHint: { color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 17 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 16
  },
  rowLabel: { fontSize: 14, color: C.muted, fontWeight: '600' },
  rowValue: { fontSize: 14, color: C.text, flexShrink: 1, textAlign: 'right' },

  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 14
  },
  pillGreen: { backgroundColor: C.greenBg },
  pillRed: { backgroundColor: C.redBg },
  pillText: { fontSize: 13, fontWeight: '700' },

  banner: { borderRadius: 10, padding: 14, marginTop: 16 },
  bannerRed: { backgroundColor: C.redBg },
  bannerRedText: { color: C.red, fontSize: 14, fontWeight: '600' },
  bannerAmber: { backgroundColor: C.amberBg },
  bannerAmberText: { color: C.amber, fontSize: 14, fontWeight: '600' },
  bannerGreen: { backgroundColor: C.greenBg },
  bannerGreenText: { color: C.green, fontSize: 14, fontWeight: '600' },

  choiceRow: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1,
    borderWidth: 2,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 20,
    alignItems: 'center'
  },
  choiceGreen: { borderColor: C.green, backgroundColor: C.greenBg },
  choiceRed: { borderColor: C.red, backgroundColor: C.redBg },
  choiceText: { fontSize: 16, fontWeight: '700', color: C.muted },
  choiceTextActive: { color: C.text },

  autoBox: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
    backgroundColor: '#F8FAFC'
  },
  autoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: C.border
  },
  autoLabel: { fontSize: 14, color: C.muted, fontWeight: '600' },
  autoValue: { fontSize: 15, color: C.text, fontWeight: '700' },
  autoChange: { fontSize: 13, color: C.blue, fontWeight: '600', marginTop: 10 },

  findingWrap: { gap: 8 },
  finding: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 15,
    backgroundColor: C.white
  },
  findingActive: { borderColor: C.blue, borderWidth: 2, backgroundColor: C.blueBg },
  findingText: { fontSize: 15, color: C.text, fontWeight: '500' },
  findingTextActive: { color: C.blue, fontWeight: '700' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  chipActive: { backgroundColor: C.blue, borderColor: C.blue },
  chipText: { fontSize: 14, color: C.muted, fontWeight: '600' },
  chipTextActive: { color: C.white }
})