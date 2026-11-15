import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets
} from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'

import SummaryScreen from './SummaryScreen'
import { NotificationBell, NotificationsScreen, useNotifications } from './Notifications'
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
  formatDateTime,
  findEquipmentByQrCode,
  getEquipmentOverview,
  getInspectorDashboard,
  addUnavailableDates,
  getMyInspectionAssignments,
  getMyStats,
  getMyUnavailableDates,
  removeUnavailableDates,
  getTechnicianDashboard,
  onSignedOut,
  relativeTime,
  restoreSession,
  setMyAvailability,
  signIn,
  signOut,
  submitInspection,
  updateRepairStatus
} from './lib/inspector'
import {
  equipmentCodeFromTitle,
  getMyNotifications,
  markNotificationsRead,
  onNotificationTap,
  registerForPush,
  showLocalNotification,
  subscribeToMyNotifications,
  unregisterPush
} from './lib/push'

// In the browser preview, Microsoft Edge adds its own eye button to every
// password box — on top of the app's "Show password". Hide Edge's one.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = 'input::-ms-reveal, input::-ms-clear { display: none; }'
  document.head.appendChild(style)
}

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
  white: '#FFFFFF',
  flame: '#F4511E'
}

// FireScan logo: the symbol alone, white frame for the navy header and navy
// frame for white cards.
const LOGO_DARK_BG = require('./assets/logo-mark-dark-bg.png')
const LOGO_LIGHT_BG = require('./assets/logo-mark-light-bg.png')

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


function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
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

// The signed-in account's dashboard data. Loaded once here (not per screen)
// so the dashboard, the notification bell and the notifications screen all
// show the same, current numbers.
function useDashboard(account) {
  const role = account ? account.role : null
  const [data, setData] = useState(null)
  // The account's own numbers and Available status (migration 009). Stays
  // null before 009 is run; the screens then use the dashboard's numbers.
  const [stats, setStats] = useState(null)
  // Inspector only: job orders from the GSO (migration 011). Null before
  // 011 is run; the dashboard then hides the card.
  const [assignments, setAssignments] = useState(null)
  // Inspector only: per-type equipment overview (migration 013)
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(
    async (silent = false) => {
      if (!role) return
      if (!silent) setError(null)
      try {
        const [main, mine, orders, totals] = await Promise.all([
          role === 'technician' ? getTechnicianDashboard() : getInspectorDashboard(),
          getMyStats().catch(() => null),
          role === 'inspector' ? getMyInspectionAssignments().catch(() => null) : null,
          role === 'inspector' ? getEquipmentOverview().catch(() => null) : null
        ])
        setData(main)
        if (mine) setStats(mine)
        if (orders) setAssignments(orders)
        if (totals) setOverview(totals)
        if (silent) setError(null)
      } catch (err) {
        if (!silent) setError(err.message)
      }
      setLoading(false)
    },
    [role]
  )

  useEffect(() => {
    setData(null)
    setStats(null)
    setAssignments(null)
    setOverview(null)
    setError(null)
    if (role) {
      setLoading(true)
      load()
    }
  }, [role, load])

  useAutoRefresh(load)

  // Saves the new status, then shows it.
  const setAvailable = useCallback(async (available) => {
    const saved = await setMyAvailability(available)
    setStats((prev) => (prev ? { ...prev, is_available: saved !== false } : prev))
  }, [])

  return { data, stats, assignments, overview, loading, error, reload: load, setAvailable }
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

// Screens that show the bottom navigation bar.
const TAB_SCREENS = ['home', 'techHome', 'notifications', 'summary']

function RootApp() {
  // 'loading' | 'login' | 'home' (inspector) | 'techHome' | 'techJob' | 'summary'
  // | 'notifications' | 'scan' | 'manual' | 'detail' | 'form' | 'done'
  const [screen, setScreen] = useState('loading')
  const [account, setAccount] = useState(null) // { id, full_name, role }
  const [equipment, setEquipment] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [job, setJob] = useState(null)
  // Where the equipment screen was opened from ('notifications' or null),
  // so Cancel / Back returns there.
  const [detailFrom, setDetailFrom] = useState(null)
  // Rows from the `notifications` table (what was pushed to this phone).
  const [history, setHistory] = useState([])

  const dashboard = useDashboard(account)
  // The inspector's job orders feed the Notifications "To do" list too.
  const notifData = useMemo(
    () => (dashboard.data ? { ...dashboard.data, assignments: dashboard.assignments || [] } : null),
    [dashboard.data, dashboard.assignments]
  )
  const notif = useNotifications(account, notifData)
  const historyUnread = history.filter((h) => !h.read_at)
  const unreadCount = notif.unread + historyUnread.length

  const pushTokenRef = useRef(null)
  const reloadRef = useRef(dashboard.reload)
  reloadRef.current = dashboard.reload

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
      setHistory([])
      setScreen('login')
    })
  }, [])

  // Once signed in: register this phone for push notifications and listen
  // for new notifications live. Every new one refreshes the dashboard.
  const accountId = account ? account.id : null
  useEffect(() => {
    if (!accountId) return
    let active = true

    registerForPush().then((token) => {
      if (active) pushTokenRef.current = token
    })
    getMyNotifications().then((rows) => {
      if (active) setHistory(rows)
    })

    const unsubscribe = subscribeToMyNotifications(accountId, (row) => {
      setHistory((prev) => [row, ...prev.filter((p) => p.id !== row.id)].slice(0, 30))
      reloadRef.current(true)
      // With a real push token the phone already shows the pushed message.
      // Without one (e.g. Expo Go) show it locally so nothing is missed.
      if (!pushTokenRef.current) {
        showLocalNotification(row.title, row.body, { notification_id: row.id, kind: row.kind })
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [accountId])

  // Tapping a notification in the phone's tray opens what it is about (the
  // job, or the equipment). If that can't be found, the Notifications screen.
  const goToScreenRef = useRef(null)
  const openHistoryRef = useRef(null)
  const handledTapRef = useRef(null)
  useEffect(() => {
    if (!accountId) return
    return onNotificationTap(async (data, id, title) => {
      if (id && handledTapRef.current === id) return
      handledTapRef.current = id
      reloadRef.current(true)
      const rows = await getMyNotifications()
      setHistory(rows)
      const row = rows.find((r) => r.id === data.notification_id) || {
        id: data.notification_id,
        title,
        action_id: data.action_id || null,
        read_at: null
      }
      try {
        await openHistoryRef.current(row, { fresh: true })
      } catch (err) {
        if (goToScreenRef.current) goToScreenRef.current('notifications')
      }
    })
  }, [accountId])

  function handleFound(item, from = null) {
    setEquipment(item)
    setDetailFrom(from)
    goToScreen('detail')
  }

  // Opens the equipment a notification is about.
  async function openEquipmentCode(code) {
    handleFound(await findEquipmentByQrCode(code), 'notifications')
  }

  function goHome() {
    setEquipment(null)
    setLastResult(null)
    setJob(null)
    setDetailFrom(null)
    dashboard.reload(true)
    goToScreen(account ? homeFor(account.role) : 'login')
  }

  function handleLogout() {
    confirmAction('Log out', 'Sign out of this account on this phone?', 'Log out', async () => {
      await unregisterPush(pushTokenRef.current)
      pushTokenRef.current = null
      await signOut()
      setAccount(null)
      setEquipment(null)
      setJob(null)
      setHistory([])
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
  goToScreenRef.current = goToScreen

  // The bell opens Notifications, and tapping it again closes them: back to
  // the tab it was opened from (Summary), otherwise the home screen.
  const notifReturnTo = useRef(null)
  function toggleNotifications() {
    if (screen === 'notifications') {
      const back = notifReturnTo.current
      notifReturnTo.current = null
      if (back === 'summary') goToScreen('summary')
      else goHome()
    } else {
      notifReturnTo.current = screen
      goToScreen('notifications')
    }
  }

  // Notifications: open what the notification is about.
  // An open job opens the job; everything else opens its equipment.
  async function openNotification(item) {
    notif.markSeen(item.id)
    // A job order is about a building: "My job orders" is on the dashboard.
    if (item.kind === 'jobOrder') {
      goHome()
      return
    }
    if (item.kind === 'job') {
      const j = ((dashboard.data && dashboard.data.assigned) || []).find((x) => x.id === item.jobId)
      if (j) {
        setJob(j)
        goToScreen('techJob')
        return
      }
    }
    if (item.code) await openEquipmentCode(item.code)
  }

  // A row from the `notifications` table: marks it read, then opens the job
  // (technician, job still open) or the equipment it is about.
  async function openHistory(row, { fresh = false } = {}) {
    if (row.id && !row.read_at) {
      markNotificationsRead([row.id]).catch(() => {})
      setHistory((prev) =>
        prev.map((h) => (h.id === row.id ? { ...h, read_at: new Date().toISOString() } : h))
      )
    }
    if (account && account.role === 'technician' && row.action_id) {
      // From the phone's tray the dashboard may not be loaded yet.
      const assigned = fresh
        ? ((await getTechnicianDashboard().catch(() => null)) || {}).assigned || []
        : (dashboard.data && dashboard.data.assigned) || []
      const j = assigned.find((x) => x.id === row.action_id)
      if (j) {
        setJob(j)
        goToScreen('techJob')
        return
      }
    }
    // An inspection assignment is about a building, not one unit: open the
    // dashboard (migration 010).
    if (row.kind === 'inspection_assigned' || row.kind === 'inspection_cancelled') {
      goHome()
      return
    }
    const code = equipmentCodeFromTitle(row.title)
    if (!code) throw new Error('This notification is not about a specific unit.')
    await openEquipmentCode(code)
  }
  openHistoryRef.current = openHistory

  function markAllRead() {
    notif.markAllSeen()
    const ids = historyUnread.map((h) => h.id)
    if (ids.length) {
      markNotificationsRead(ids).catch(() => {})
      const now = new Date().toISOString()
      setHistory((prev) => prev.map((h) => (h.read_at ? h : { ...h, read_at: now })))
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
        (screen === 'detail' && detailFrom !== 'notifications') ||
        screen === 'done' ||
        screen === 'techJob' ||
        screen === 'summary' ||
        screen === 'notifications'
      ) {
        goHome()
        return true
      }
      if (screen === 'detail') {
        setScreen('notifications')
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
  }, [screen, account, detailFrom])

  const roleLabel = account ? ROLE_LABELS[account.role] || account.role : ''
  const signedIn = account && screen !== 'loading' && screen !== 'login'
  const showTabs = signedIn && TAB_SCREENS.includes(screen)

  return (
    <SafeAreaView key={screen} style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.navy} />

      {screen !== 'scan' && (
        <View style={s.header}>
          <Image source={LOGO_DARK_BG} style={s.headerLogo} accessibilityLabel="FireScan logo" />
          <View style={s.flex}>
            <Text style={s.headerTitle}>
              Fire<Text style={s.brandScan}>Scan</Text>
            </Text>
            <Text style={s.headerSub}>
              {account ? `${roleLabel}: ${account.full_name}` : 'NBSC Fire Safety Equipment Monitoring and Inspection'}
            </Text>
          </View>
          {signedIn && (
            <NotificationBell
              count={unreadCount}
              open={screen === 'notifications'}
              onPress={toggleNotifications}
            />
          )}
          {signedIn && (
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
        <HomeScreen account={account} dashboard={dashboard} onOpenEquipment={handleFound} />
      )}

      {screen === 'techHome' && (
        <TechnicianHome
          account={account}
          dashboard={dashboard}
          onOpenJob={(j) => {
            setJob(j)
            setScreen('techJob')
          }}
        />
      )}

      {screen === 'notifications' && account && (
        <NotificationsScreen
          role={account.role}
          items={notif.items}
          history={history}
          onOpen={openNotification}
          onOpenHistory={openHistory}
          onMarkAll={markAllRead}
          onBack={goHome}
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
          canInspect={account && account.role === 'inspector'}
          onInspect={() => setScreen('form')}
          onCancel={detailFrom === 'notifications' ? () => goToScreen('notifications') : goHome}
        />
      )}

      {screen === 'form' && (
        <InspectionForm
          equipment={equipment}
          onSubmitted={(result) => {
            setLastResult(result)
            dashboard.reload(true)
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

      {showTabs && (
        <BottomTabs
          role={account.role}
          screen={screen}
          onNavigate={(next) => {
            if (next === 'home' || next === 'techHome') goHome()
            else goToScreen(next)
          }}
        />
      )}
    </SafeAreaView>
  )
}

/* ------------------------------------------------------------------ */
/* Bottom navigation                                                   */
/* ------------------------------------------------------------------ */

// Notifications open from the bell in the header, so they have no tab here.
// The inspector's Scan button sits in the center, slightly larger.
function BottomTabs({ role, screen, onNavigate }) {
  const tabs =
    role === 'technician'
      ? [
          { key: 'techHome', icon: 'home-outline', label: 'Dashboard' },
          { key: 'summary', icon: 'bar-chart-outline', label: 'Summary' }
        ]
      : [
          { key: 'home', icon: 'home-outline', label: 'Dashboard' },
          { key: 'scan', icon: 'scan-outline', label: 'Scan QR', center: true },
          { key: 'summary', icon: 'bar-chart-outline', label: 'Summary' }
        ]

  return (
    <View style={s.tabBar}>
      {tabs.map((t) => {
        const active = screen === t.key
        if (t.center) {
          return (
            <Pressable key={t.key} style={s.tab} onPress={() => onNavigate(t.key)}>
              <View style={s.scanTabBtn}>
                <Ionicons name={t.icon} size={24} color={C.white} />
              </View>
              <Text style={[s.tabLabel, s.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          )
        }
        return (
          <Pressable key={t.key} style={s.tab} onPress={() => onNavigate(t.key)}>
            <Ionicons name={t.icon} size={22} color={active ? C.blue : C.muted} />
            <Text style={[s.tabLabel, active && s.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/* ------------------------------------------------------------------ */
/* Login (inspector and technician accounts)                           */
/* ------------------------------------------------------------------ */

// A ScrollView that stays usable while the keyboard is open, on every phone.
// Android phones handle the keyboard differently (and since edge-to-edge the
// screen no longer shrinks by itself), so this does not rely on them:
//   - the keyboard's height is added as extra space at the bottom, so you
//     can always scroll down past the last field;
//   - the box you are typing in is scrolled up above the keyboard, also when
//     you move to the next box while the keyboard stays open.
function KeyboardScroll({ children, contentContainerStyle, onScroll, ...props }) {
  const ref = useRef(null)
  const scrollY = useRef(0)
  const keyboardTop = useRef(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    let watch = null
    let lastInput = null

    function revealFocused() {
      const input = TextInput.State.currentlyFocusedInput && TextInput.State.currentlyFocusedInput()
      if (!input || !input.measureInWindow || !ref.current || keyboardTop.current === null) return
      input.measureInWindow((x, y, w, h) => {
        const overlap = y + h + 24 - keyboardTop.current
        if (overlap > 0) ref.current.scrollTo({ y: scrollY.current + overlap, animated: true })
      })
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const onShow = Keyboard.addListener(showEvent, (e) => {
      const height = (e.endCoordinates && e.endCoordinates.height) || 0
      keyboardTop.current = (e.endCoordinates && e.endCoordinates.screenY) || null
      setKeyboardHeight(height)
      // Wait a moment for the extra space to be laid out, then scroll.
      setTimeout(revealFocused, 120)
      clearInterval(watch)
      lastInput = TextInput.State.currentlyFocusedInput && TextInput.State.currentlyFocusedInput()
      // Moving to another box doesn't reopen the keyboard, so watch for it.
      watch = setInterval(() => {
        const now = TextInput.State.currentlyFocusedInput && TextInput.State.currentlyFocusedInput()
        if (now && now !== lastInput) {
          lastInput = now
          revealFocused()
        }
      }, 250)
    })
    const onHide = Keyboard.addListener(hideEvent, () => {
      clearInterval(watch)
      keyboardTop.current = null
      setKeyboardHeight(0)
    })
    return () => {
      clearInterval(watch)
      onShow.remove()
      onHide.remove()
    }
  }, [])

  return (
    <ScrollView
      ref={ref}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={(e) => {
        scrollY.current = e.nativeEvent.contentOffset.y
        if (onScroll) onScroll(e)
      }}
      contentContainerStyle={[contentContainerStyle, keyboardHeight ? { paddingBottom: keyboardHeight + 48 } : null]}
      {...props}
    >
      {children}
    </ScrollView>
  )
}

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
    <KeyboardScroll contentContainerStyle={s.scroll}>
      <View style={s.card}>
        <View style={s.loginBrand}>
          <Image source={LOGO_LIGHT_BG} style={s.loginLogo} accessibilityLabel="FireScan logo" />
          <Text style={s.loginBrandName}>
            Fire<Text style={s.brandScan}>Scan</Text>
          </Text>
          <Text style={s.loginTagline}>NBSC Fire Safety Equipment Monitoring and Inspection</Text>
        </View>
        <Text style={s.h1}>Sign in</Text>
        <Text style={s.muted}>
          Use the account the GSO created for you. Inspectors scan and inspect equipment;
          technicians see and update their assigned repairs.
        </Text>

        <Text style={s.label}>Username</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Username (or email)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="default"
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
    </KeyboardScroll>
  )
}

/* ------------------------------------------------------------------ */
/* Dashboard building blocks                                           */
/* ------------------------------------------------------------------ */

function DashHero({ name, line }) {
  return (
    <View style={s.hero}>
      <Text style={s.heroGreeting}>{greeting()},</Text>
      <Text style={s.heroName}>{name}</Text>
      <Text style={s.heroDate}>{todayLabel()}</Text>
      {line ? <Text style={s.heroLine}>{line}</Text> : null}
    </View>
  )
}

// One KPI box on the dashboard grid. Tappable when `onPress` is given.
function DashTile({ value, label, tone, active, onPress }) {
  const color =
    tone === 'red' ? C.red : tone === 'amber' ? C.amber : tone === 'green' ? C.green : tone === 'blue' ? C.blue : C.text
  const Box = onPress ? Pressable : View
  return (
    <Box style={[s.dashTile, active && s.statActive]} onPress={onPress}>
      <Text style={[s.dashTileValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value ?? 0}
      </Text>
      <Text style={s.dashTileLabel}>{label}</Text>
    </Box>
  )
}


function ErrorCard({ error }) {
  if (!error) return null
  return (
    <View style={[s.card, { backgroundColor: C.redBg, borderColor: '#F5C2C2' }]}>
      <Text style={[s.error, { marginTop: 0 }]}>{error}</Text>
    </View>
  )
}

/* ------------------------------------------------------------------ */
/* Inspector dashboard                                                 */
/* ------------------------------------------------------------------ */

function HomeScreen({ account, dashboard, onOpenEquipment }) {
  const { data, stats, loading, error, reload } = dashboard
  // Separate from `loading` so pull-to-refresh actually shows its spinner.
  const [refreshing, setRefreshing] = useState(false)
  const [openError, setOpenError] = useState(null)
  // Which list shows under the boxes.
  const [listKey, setListKey] = useState('due')
  const [showAll, setShowAll] = useState(false)
  const [showAllRecent, setShowAllRecent] = useState(false)

  async function onRefresh() {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }

  async function openFromDue(code) {
    setOpenError(null)
    try {
      onOpenEquipment(await findEquipmentByQrCode(code))
    } catch (err) {
      setOpenError(err.message)
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
  const recent = (data && data.recent) || []
  const neverInspectedList = dueList.filter((d) => !d.last_inspected)

  // The database sends at most 10 rows per list, so the boxes use its real
  // totals (migration 004). Before 004 is run, fall back to the list lengths.
  const dueCount = data && data.due_count != null ? data.due_count : dueList.length
  const neverInspected =
    data && data.never_inspected_count != null ? data.never_inspected_count : neverInspectedList.length
  const onHoldCount = data && data.on_hold_count != null ? data.on_hold_count : onHoldList.length

  // An inspection result is what the unit was AT the time. Show what it is
  // NOW, from the unit's current status (sent by migration 004). Before 004,
  // fall back to on-hold membership.
  const onHoldCodes = new Set(onHoldList.map((d) => d.equipment_code))
  function resultState(r) {
    if (r.condition_status !== 'defective') {
      return { tag: 'OK', color: C.green, bg: s.tagGreen, note: 'Functional' }
    }
    const finding = r.findings || 'Defective'
    const stillOpen = r.current_status
      ? OPEN_PROBLEM_STATUSES.includes(r.current_status)
      : onHoldCodes.has(r.equipment_code)
    if (stillOpen) {
      return { tag: 'Still defective', color: C.red, bg: s.tagRed, note: `${finding} · waiting for GSO` }
    }
    const replaced = r.current_status
      ? r.current_status === 'no_longer_in_service'
      : (r.equipment_code || '').startsWith('FE-')
    if (replaced) {
      return { tag: 'Replaced', color: C.green, bg: s.tagGreen, note: `${finding} · GSO replaced this unit` }
    }
    if (r.current_status && r.current_status !== 'functional') {
      const label = STATUS_LABELS[r.current_status] || r.current_status
      return { tag: label, color: C.amber, bg: { backgroundColor: C.amberBg }, note: `${finding} · now ${label}` }
    }
    return { tag: 'Fixed', color: C.green, bg: s.tagGreen, note: `${finding} · resolved by GSO, now functional` }
  }

  // Open defects: units this inspector reported defective that are still
  // waiting for GSO. Migration 004 sends the complete list; before it,
  // build it from the recent inspections. One row per unit.
  let openDefects = data && data.open_defects
  if (!openDefects) {
    openDefects = []
    recent.forEach((r) => {
      if (
        r.condition_status === 'defective' &&
        onHoldCodes.has(r.equipment_code) &&
        !openDefects.some((o) => o.equipment_code === r.equipment_code)
      ) {
        openDefects.push(r)
      }
    })
  }

  // My inspections: the same four numbers as this inspector's card on the
  // web Inspectors page (get_my_stats, migration 009).
  const mine = {
    today: stats ? stats.today : data ? data.today_count : 0,
    week: stats ? stats.week : data ? data.week_count : 0,
    total: stats ? stats.total : null,
    defects: stats ? stats.defects : data ? data.defect_count : 0
  }

  // The four boxes pick which list shows below them.
  const lists = {
    due: { title: 'Can be inspected', hint: 'Longest since last check first.', items: dueList, total: dueCount, kind: 'unit' },
    never: { title: 'Never inspected', hint: 'These have no inspection yet.', items: neverInspectedList, total: neverInspected, kind: 'unit' },
    defects: { title: 'Open defects', hint: 'You reported these. Waiting for GSO.', items: openDefects, total: openDefects.length, kind: 'result' },
    hold: { title: 'On hold (waiting for GSO)', hint: 'Can be inspected again once GSO records the outcome.', items: onHoldList, total: onHoldCount, kind: 'hold' }
  }
  const list = lists[listKey]
  const shown = showAll ? list.items : list.items.slice(0, 5)
  const recentShown = showAllRecent ? recent : recent.slice(0, 3)

  function pick(key) {
    setListKey(key)
    setShowAll(false)
  }

  return (
    <KeyboardScroll
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <DashHero
        name={account.full_name}
        line={
          data
            ? `${dueCount} unit${dueCount === 1 ? '' : 's'} can be inspected · ${onHoldCount} on hold`
            : null
        }
      />

      <ErrorCard error={error || openError} />

      {loading && !data ? (
        <View style={[s.card, s.centerPad]}>
          <ActivityIndicator color={C.blue} />
        </View>
      ) : data ? (
        <>
          <AvailabilityCard dashboard={dashboard} />
          <UnavailableDatesCard account={account} />

          <JobOrdersCard assignments={dashboard.assignments} />

          <View style={s.card}>
            <Text style={s.sectionTitle}>My inspections</Text>
            <View style={s.miniStats}>
              <MiniStat value={mine.today} label="Today" />
              <MiniStat value={mine.week} label="This week" />
              <MiniStat value={mine.total} label="Total" />
              <MiniStat value={mine.defects} label="Defects" color={mine.defects > 0 ? C.red : undefined} />
            </View>
            {mine.total === null && (
              <Text style={[s.sectionHint, { marginTop: 6, marginBottom: 0 }]}>
                Total shows once the GSO runs the latest database update.
              </Text>
            )}
          </View>

          <EquipmentOverviewCard overview={dashboard.overview} />

          <View style={s.dashGrid}>
            <DashTile value={dueCount} label="Can be inspected" tone={dueCount > 0 ? 'amber' : 'green'} active={listKey === 'due'} onPress={() => pick('due')} />
            <DashTile value={neverInspected} label="Never inspected" tone={neverInspected > 0 ? 'red' : undefined} active={listKey === 'never'} onPress={() => pick('never')} />
            <DashTile value={openDefects.length} label="Open defects" tone={openDefects.length > 0 ? 'red' : 'green'} active={listKey === 'defects'} onPress={() => pick('defects')} />
            <DashTile value={onHoldCount} label="On hold (GSO)" tone={onHoldCount > 0 ? 'amber' : undefined} active={listKey === 'hold'} onPress={() => pick('hold')} />
          </View>

          <Text style={s.sectionTitle}>{list.title}</Text>
          <Text style={s.sectionHint}>{list.hint}</Text>
          <View style={s.card}>
            {list.items.length === 0 ? (
              <Text style={s.muted}>
                {listKey === 'defects'
                  ? '✓ No open defects. Everything you reported has been resolved by GSO.'
                  : 'Nothing here right now.'}
              </Text>
            ) : (
              shown.map((d, i) => {
                const last = i === shown.length - 1
                if (list.kind === 'result') {
                  const st = resultState(d)
                  return (
                    <View key={d.id} style={[s.listRow, last && s.listRowLast]}>
                      <View style={s.flex}>
                        <Text style={s.listCode}>{d.equipment_code}</Text>
                        <Text style={s.listMeta}>{st.note}</Text>
                        <Text style={s.listMeta}>Reported {formatDateTime(d.inspection_date)}</Text>
                      </View>
                      <View style={[s.tag, st.bg]}>
                        <Text style={[s.tagText, { color: st.color }]}>{st.tag}</Text>
                      </View>
                    </View>
                  )
                }
                const needsAttention = d.current_status && d.current_status !== 'functional'
                return (
                  <Pressable
                    key={d.id}
                    style={[s.listRow, last && s.listRowLast]}
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
                    {list.kind === 'hold' ? (
                      <View style={[s.tag, s.tagRed]}>
                        <Text style={[s.tagText, { color: C.red }]}>
                          {STATUS_LABELS[d.current_status] || d.current_status}
                        </Text>
                      </View>
                    ) : (
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={[s.listWhen, !d.last_inspected && { color: C.red, fontWeight: '700' }]}>
                          {d.last_inspected ? formatDateTime(d.last_inspected) : 'Never inspected'}
                        </Text>
                        {needsAttention && (
                          <View style={[s.tag, s.tagRed]}>
                            <Text style={[s.tagText, { color: C.red }]}>
                              {STATUS_LABELS[d.current_status] || d.current_status}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </Pressable>
                )
              })
            )}
            {list.items.length > 5 && (
              <Pressable onPress={() => setShowAll(!showAll)} hitSlop={6}>
                <Text style={s.seeAll}>{showAll ? 'Show less' : `See all ${list.items.length} →`}</Text>
              </Pressable>
            )}
            {list.total > list.items.length && (
              <Text style={[s.sectionHint, { marginTop: 8, marginBottom: 0 }]}>
                The app lists {list.items.length} of {list.total}. The ones
                {listKey === 'hold' ? ' reported most recently' : ' waiting longest'} come first.
              </Text>
            )}
          </View>

          <Text style={s.sectionTitle}>Your recent inspections</Text>
          <View style={[s.card, { marginTop: 8 }]}>
            {recent.length === 0 ? (
              <Text style={s.muted}>Nothing submitted yet.</Text>
            ) : (
              recentShown.map((r, i) => {
                const st = resultState(r)
                return (
                  <View key={r.id} style={[s.listRow, i === recentShown.length - 1 && s.listRowLast]}>
                    <View style={s.flex}>
                      <Text style={s.listCode}>{r.equipment_code}</Text>
                      <Text style={s.listMeta}>{st.note}</Text>
                      <Text style={s.listMeta}>{formatDateTime(r.inspection_date)}</Text>
                    </View>
                    <View style={[s.tag, st.bg]}>
                      <Text style={[s.tagText, { color: st.color }]}>{st.tag}</Text>
                    </View>
                  </View>
                )
              })
            )}
            {recent.length > 3 && (
              <Pressable onPress={() => setShowAllRecent(!showAllRecent)} hitSlop={6}>
                <Text style={s.seeAll}>{showAllRecent ? 'Show less' : `See your last ${recent.length} →`}</Text>
              </Pressable>
            )}
          </View>
        </>
      ) : null}
    </KeyboardScroll>
  )
}

// 'YYYY-MM-DD' for today on this phone, and a date-only string shown as
// "Nov 12, 2026" without the one-day shift a bare date gets when read as UTC.
function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '')
  if (!m) return ymd || ''
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Inspector: the job orders the GSO gave them (a building or one floor to
// inspect, by a date). Most urgent first, then the earliest due date — the
// database sends them in that order. Tap one to see its units and which are
// ready to inspect (by scanning their QR sticker). A job order leaves the
// list once every unit is inspected.
function JobOrdersCard({ assignments }) {
  const [openId, setOpenId] = useState(null)
  // Before migration 011 there is nothing to show.
  if (!assignments) return null
  const today = todayYmd()

  return (
    <View style={s.card}>
      <Text style={s.sectionTitle}>My job orders</Text>
      <Text style={[s.sectionHint, { marginBottom: 4 }]}>
        From the GSO. Most urgent first. Tap one to see what to inspect.
      </Text>
      {assignments.length === 0 ? (
        <Text style={s.muted}>No job orders right now.</Text>
      ) : (
        assignments.map((a, idx) => {
          const pc = PRIORITY_COLORS[a.priority] || PRIORITY_COLORS.medium
          const late = a.due_date < today
          const dueToday = a.due_date === today
          const total = Number(a.total || 0)
          const done = Number(a.done || 0)
          const onHold = Number(a.on_hold || 0)
          const open = openId === a.id
          return (
            <View key={a.id} style={[s.jobOrder, { borderLeftColor: pc.fg }, idx === 0 && { marginTop: 6 }]}>
              <Pressable onPress={() => setOpenId(open ? null : a.id)}>
                <View style={s.jobOrderTop}>
                  <Text style={[s.listCode, s.flex]}>
                    {a.building_name}
                    {a.floor_label ? ` — ${a.floor_label}` : ' (whole building)'}
                  </Text>
                  <View style={[s.tag, { backgroundColor: pc.bg }]}>
                    <Text style={[s.tagText, { color: pc.fg }]}>
                      {a.priority.charAt(0).toUpperCase() + a.priority.slice(1)}
                    </Text>
                  </View>
                </View>
                <View style={s.jobOrderLine}>
                  <Text style={s.listMeta}>Inspect on or before {formatYmd(a.due_date)}</Text>
                  {late ? (
                    <View style={[s.tag, s.tagRed]}>
                      <Text style={[s.tagText, { color: C.red }]}>Overdue</Text>
                    </View>
                  ) : dueToday ? (
                    <View style={[s.tag, { backgroundColor: C.blueBg }]}>
                      <Text style={[s.tagText, { color: C.blue }]}>Due today</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.listMeta}>
                  {done} of {total} unit{total === 1 ? '' : 's'} inspected
                  {onHold > 0 ? ` · ${onHold} on hold (waiting for GSO)` : ''}
                </Text>
                <View style={s.jobOrderBar}>
                  <View style={{ width: `${total ? (done / total) * 100 : 0}%`, height: '100%', backgroundColor: C.green }} />
                </View>
                {a.notes ? <Text style={[s.listMeta, { color: C.text }]}>GSO says: “{a.notes}”</Text> : null}
                <Text style={s.jobOrderToggle}>{open ? 'Hide units ▲' : 'Show units ▼'}</Text>
              </Pressable>

              {open && (
                <Text style={[s.sectionHint, { marginTop: 6, marginBottom: 0 }]}>
                  Go to each unit and scan its QR sticker to inspect it.
                </Text>
              )}

              {open &&
                (a.units || []).map((u, i, arr) => {
                  const hold = !u.inspected && OPEN_PROBLEM_STATUSES.includes(u.current_status)
                  return (
                    <View key={u.id} style={[s.listRow, i === arr.length - 1 && s.listRowLast]}>
                      <View style={s.flex}>
                        <Text style={s.listCode}>{u.equipment_code}</Text>
                        <Text style={s.listMeta}>
                          {TYPE_LABELS[u.equipment_type] || u.equipment_type} · {u.exact_location}
                        </Text>
                      </View>
                      {u.inspected ? (
                        <View style={[s.tag, s.tagGreen]}>
                          <Text style={[s.tagText, { color: C.green }]}>✓ Inspected</Text>
                        </View>
                      ) : hold ? (
                        <View style={[s.tag, { backgroundColor: C.amberBg }]}>
                          <Text style={[s.tagText, { color: C.amber }]}>On hold</Text>
                        </View>
                      ) : (
                        // Only a label: the inspection starts by scanning the
                        // unit's QR sticker, which proves the inspector is there.
                        <View style={[s.tag, { backgroundColor: C.blueBg }]}>
                          <Text style={[s.tagText, { color: C.blue }]} numberOfLines={1}>
                            Ready to inspect
                          </Text>
                        </View>
                      )}
                    </View>
                  )
                })}
            </View>
          )
        })
      )}
    </View>
  )
}

// Inspector: per equipment type, how many units in service there are, how
// many were inspected this month, and how many work / need attention. The
// system counts these from every inspection and repair — the same numbers
// as the web Stock page. Example: "Fire Extinguisher — 1 of 20 inspected
// this month · 18 functional · 2 need attention".
function EquipmentOverviewCard({ overview }) {
  // Before migration 013 there is nothing to show.
  if (!overview || overview.length === 0) return null
  return (
    <View style={s.card}>
      <Text style={s.sectionTitle}>Equipment overview</Text>
      <Text style={[s.sectionHint, { marginBottom: 4 }]}>All units in service, by type. Updated with every inspection.</Text>
      {overview.map((o, i) => {
        const total = Number(o.total || 0)
        const ok = Number(o.functional || 0)
        const bad = Number(o.needs_attention || 0)
        const inspected = Number(o.inspected || 0)
        return (
          <View key={o.equipment_type} style={[s.overviewRow, i === 0 && { borderTopWidth: 0 }]}>
            <View style={s.jobOrderTop}>
              <Text style={[s.listCode, s.flex]}>{TYPE_LABELS[o.equipment_type] || o.equipment_type}</Text>
              <Text style={s.listCode}>{total}</Text>
            </View>
            <Text style={s.listMeta}>
              Inspected this month: <Text style={{ fontWeight: '700', color: C.text }}>{inspected} of {total}</Text>
              {inspected > 0 ? ` · ${o.inspected_ok} functional · ${o.inspected_bad} defective` : ''}
            </Text>
            <View style={s.jobOrderBar}>
              {ok > 0 && <View style={{ width: `${(ok / Math.max(1, total)) * 100}%`, height: '100%', backgroundColor: C.green }} />}
              {bad > 0 && <View style={{ width: `${(bad / Math.max(1, total)) * 100}%`, height: '100%', backgroundColor: C.red }} />}
            </View>
            <Text style={s.listMeta}>
              <Text style={{ color: C.green, fontWeight: '700' }}>{ok} functional ({total ? Math.round((ok / total) * 100) : 0}%)</Text>
              {'  ·  '}
              <Text style={{ color: C.red, fontWeight: '700' }}>{bad} need attention ({total ? Math.round((bad / total) * 100) : 0}%)</Text>
            </Text>
          </View>
        )
      })}
    </View>
  )
}

// One number with its label, in the "My inspections" / "My jobs" row. The
// same numbers, in the same order, as the person's card on the web.
function MiniStat({ value, label, color }) {
  return (
    <View style={s.miniStat}>
      <Text style={[s.miniStatValue, color && { color }]}>{value == null ? '—' : value}</Text>
      <Text style={s.miniStatLabel}>{label}</Text>
    </View>
  )
}

const CAL_WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function ymdOfDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Dates the inspector / technician will be unavailable (migration 012).
// Tap "Add dates", tap the first day and the last day on the calendar, add a
// reason if you like, then Save. The GSO sees them on the web (calendar
// button on your card).
function UnavailableDatesCard({ account }) {
  const [rows, setRows] = useState(undefined) // undefined = loading, null = not set up yet
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [start, setStart] = useState(null)
  const [end, setEnd] = useState(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    try {
      setRows(await getMyUnavailableDates())
    } catch (e) {
      setErr(e.message)
      setRows([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Before migration 012 there is nothing to show.
  if (rows === undefined || rows === null) return null

  const today = ymdOfDate(new Date())
  const upcoming = rows.filter((r) => r.end_date >= today)

  function pickDay(ymd) {
    if (ymd < today) return
    // First tap = first day; second tap = last day (either order).
    if (!start || end) {
      setStart(ymd)
      setEnd(null)
    } else if (ymd < start) {
      setEnd(start)
      setStart(ymd)
    } else {
      setEnd(ymd)
    }
  }

  function startAdding() {
    setAdding(true)
    setStart(null)
    setEnd(null)
    setReason('')
    setErr(null)
  }

  async function save() {
    if (!start) return
    setErr(null)
    setSaving(true)
    try {
      await addUnavailableDates(account.id, start, end || start, reason)
      setAdding(false)
      await load()
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  function remove(r) {
    const label = r.end_date !== r.start_date ? `${formatYmd(r.start_date)} – ${formatYmd(r.end_date)}` : formatYmd(r.start_date)
    confirmAction('Remove these dates?', `${label}\n\nThe GSO will see you as available on these days again.`, 'Remove', async () => {
      try {
        await removeUnavailableDates(r.id)
        await load()
      } catch (e) {
        setErr(e.message)
      }
    }, true)
  }

  const first = month.getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ymdOfDate(new Date(month.getFullYear(), month.getMonth(), i + 1)))
  ]
  const last = end || start
  const isPicked = (ymd) => start && ymd >= start && ymd <= last
  const isSaved = (ymd) => rows.some((r) => r.start_date <= ymd && ymd <= r.end_date)

  return (
    <View style={s.card}>
      <Pressable style={s.availCard} onPress={() => setOpen(!open)}>
        <Ionicons name="calendar-outline" size={22} color={C.navy} />
        <View style={s.flex}>
          <Text style={s.availLabel}>Unavailable dates</Text>
          <Text style={s.availHint}>
            {upcoming.length === 0
              ? 'None set. Tap to add the days you will be away.'
              : `${upcoming.length} upcoming · next: ${formatYmd(upcoming[0].start_date)}`}
          </Text>
        </View>
        <Text style={s.jobOrderToggle}>{open ? '▲' : '▼'}</Text>
      </Pressable>

      {open && (
        <View style={{ marginTop: 10 }}>
          {upcoming.map((r) => (
            <View key={r.id} style={s.listRow}>
              <View style={s.flex}>
                <Text style={s.listCode}>
                  {formatYmd(r.start_date)}
                  {r.end_date !== r.start_date ? ` – ${formatYmd(r.end_date)}` : ''}
                </Text>
                {r.reason ? <Text style={s.listMeta}>{r.reason}</Text> : null}
              </View>
              <Pressable onPress={() => remove(r)} hitSlop={8}>
                <Text style={[s.statPanelClose, { color: C.red }]}>Remove</Text>
              </Pressable>
            </View>
          ))}

          {!adding ? (
            <Pressable style={[s.smallBtn, s.smallBtnPrimary, { marginTop: 10 }]} onPress={startAdding}>
              <Text style={s.smallBtnPrimaryText}>+ Add dates</Text>
            </Pressable>
          ) : (
            <View style={{ marginTop: 10 }}>
              <View style={s.calHead}>
                <Pressable hitSlop={8} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                  <Ionicons name="chevron-back" size={20} color={C.text} />
                </Pressable>
                <Text style={s.listCode}>
                  {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </Text>
                <Pressable hitSlop={8} onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                  <Ionicons name="chevron-forward" size={20} color={C.text} />
                </Pressable>
              </View>
              <View style={s.calGrid}>
                {CAL_WEEKDAYS.map((w, i) => (
                  <Text key={`w${i}`} style={s.calWeekday}>{w}</Text>
                ))}
                {cells.map((ymd, i) => {
                  if (!ymd) return <View key={`b${i}`} style={s.calCell} />
                  const past = ymd < today
                  const picked = isPicked(ymd)
                  const saved = isSaved(ymd)
                  return (
                    <Pressable
                      key={ymd}
                      style={[s.calCell, saved && s.calSaved, picked && s.calPicked, ymd === today && s.calToday]}
                      onPress={() => pickDay(ymd)}
                      disabled={past}
                    >
                      <Text style={[s.calDayText, past && { color: C.border }, (picked || saved) && { color: C.white, fontWeight: '800' }]}>
                        {Number(ymd.slice(8))}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              <Text style={[s.availHint, { marginTop: 6 }]}>
                {!start
                  ? 'Tap the first day you will be unavailable.'
                  : !end
                  ? `${formatYmd(start)} · tap the last day (or Save for one day).`
                  : `${formatYmd(start)} – ${formatYmd(end)}`}
              </Text>
              <TextInput
                style={[s.input, { marginTop: 8 }]}
                value={reason}
                onChangeText={setReason}
                placeholder="Reason (optional), e.g. Sick leave"
              />
              <View style={s.nextJobActions}>
                <Pressable style={[s.smallBtn, s.smallBtnGhost]} onPress={() => setAdding(false)} disabled={saving}>
                  <Text style={s.smallBtnGhostText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[s.smallBtn, s.smallBtnPrimary, (!start || saving) && { opacity: 0.5 }]}
                  onPress={save}
                  disabled={!start || saving}
                >
                  <Text style={s.smallBtnPrimaryText}>{saving ? 'Saving...' : 'Save dates'}</Text>
                </Pressable>
              </View>
            </View>
          )}
          {err ? <Text style={[s.error, { marginTop: 8 }]}>{err}</Text> : null}
        </View>
      )}
    </View>
  )
}

// Available / Unavailable, set by the inspector or technician themselves.
// The GSO sees it on the web Inspectors / Technicians page.
function AvailabilityCard({ dashboard }) {
  const { stats, setAvailable } = dashboard
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  // Before migration 009 there is nothing to switch.
  if (!stats) return null
  const available = stats.is_available !== false

  async function change(next) {
    setErr(null)
    setSaving(true)
    try {
      await setAvailable(next)
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  return (
    <View style={[s.card, s.availCard]}>
      <View style={s.flex}>
        <Text style={s.availLabel}>My status</Text>
        <Text style={[s.availValue, { color: available ? C.green : C.muted }]}>
          {available ? '● Available' : '○ Unavailable'}
        </Text>
        <Text style={s.availHint}>
          {available ? 'The GSO sees you as available.' : 'The GSO sees you as unavailable.'}
        </Text>
        {err ? <Text style={[s.error, { marginTop: 4 }]}>{err}</Text> : null}
      </View>
      {saving ? (
        <ActivityIndicator color={C.blue} />
      ) : (
        <Switch
          value={available}
          onValueChange={change}
          trackColor={{ false: C.border, true: '#86EFAC' }}
          thumbColor={available ? C.green : '#F1F5F9'}
        />
      )}
    </View>
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

function TechnicianHome({ account, dashboard, onOpenJob }) {
  const { data, stats, loading, error, reload } = dashboard
  const [refreshing, setRefreshing] = useState(false)
  const [listKey, setListKey] = useState('todo')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(null)

  async function onRefresh() {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }

  const jobs = (data && data.assigned) || []
  const recentDone = (data && data.recent_done) || []
  const todoJobs = jobs.filter((j) => j.repair_status !== 'repaired')
  const awaitingJobs = jobs.filter((j) => j.repair_status === 'repaired')
  const urgent = todoJobs.filter((j) => j.priority === 'critical' || j.priority === 'high').length
  // The database returns assigned jobs highest priority first.
  const nextJob = todoJobs[0]

  // My jobs: the same three numbers as this technician's card on the web
  // Technicians page (get_my_stats, migration 009).
  const mine = {
    assigned: stats ? stats.assigned : data ? data.to_do_count || 0 : 0,
    working: stats ? stats.working : todoJobs.filter((j) => j.repair_status === 'working').length,
    completed: stats ? stats.completed : data ? data.done_count || 0 : 0
  }
  const awaitingCount = stats ? stats.awaiting_gso : data ? data.awaiting_gso_count || 0 : 0

  const lists = {
    todo: { label: 'To do', items: todoJobs, total: mine.assigned },
    awaiting: { label: 'Awaiting GSO', items: awaitingJobs, total: awaitingCount },
    done: { label: 'Done', items: recentDone, total: mine.completed, completed: true }
  }
  const list = lists[listKey]

  function startWorking(job) {
    confirmAction(
      'Start working',
      `Mark ${job.equipment_code} as "Working on it"? The GSO will see that you started.`,
      'Start',
      async () => {
        setStartError(null)
        setStarting(true)
        try {
          await updateRepairStatus(job.id, 'working')
          await reload(true)
        } catch (err) {
          setStartError(err.message)
        }
        setStarting(false)
      }
    )
  }

  return (
    <KeyboardScroll
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <DashHero
        name={account.full_name}
        line={
          data
            ? todoJobs.length > 0
              ? `You have ${mine.assigned} job${mine.assigned === 1 ? '' : 's'} to do${urgent > 0 ? ` · ${urgent} urgent` : ''}`
              : 'No open jobs right now.'
            : null
        }
      />

      <ErrorCard error={error || startError} />

      {loading && !data ? (
        <View style={[s.card, s.centerPad]}>
          <ActivityIndicator color={C.blue} />
        </View>
      ) : data ? (
        <>
          <AvailabilityCard dashboard={dashboard} />
          <UnavailableDatesCard account={account} />

          <View style={s.card}>
            <Text style={s.sectionTitle}>My jobs</Text>
            <View style={s.miniStats}>
              <MiniStat value={mine.assigned} label="Assigned" />
              <MiniStat value={mine.working} label="Working" />
              <MiniStat value={mine.completed} label="Completed" color={mine.completed > 0 ? C.green : undefined} />
            </View>
          </View>

          {nextJob && (
            <View style={[s.card, s.nextJob, { borderLeftColor: (PRIORITY_COLORS[nextJob.priority] || PRIORITY_COLORS.medium).fg }]}>
              <Text style={[s.nextJobLabel, { color: (PRIORITY_COLORS[nextJob.priority] || PRIORITY_COLORS.medium).fg }]}>
                NEXT UP
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <Text style={[s.listCode, { fontSize: 18 }]}>{nextJob.equipment_code}</Text>
                <PriorityTag priority={nextJob.priority} />
              </View>
              <Text style={s.listMeta}>
                {TYPE_LABELS[nextJob.equipment_type] || nextJob.equipment_type}
                {nextJob.building_name ? ` · ${nextJob.building_name}` : ''}
                {nextJob.exact_location ? ` · ${nextJob.exact_location}` : ''}
              </Text>
              <Text style={[s.listMeta, { color: C.text, marginTop: 4 }]}>{nextJob.description}</Text>
              <View style={s.nextJobActions}>
                <Pressable style={[s.smallBtn, s.smallBtnGhost]} onPress={() => onOpenJob(nextJob)}>
                  <Text style={s.smallBtnGhostText}>Open job</Text>
                </Pressable>
                {(nextJob.repair_status || 'assigned') === 'assigned' ? (
                  <Pressable
                    style={[s.smallBtn, s.smallBtnPrimary, starting && { opacity: 0.6 }]}
                    onPress={() => startWorking(nextJob)}
                    disabled={starting}
                  >
                    <Text style={s.smallBtnPrimaryText}>{starting ? 'Saving...' : 'Start working'}</Text>
                  </Pressable>
                ) : (
                  <View style={[s.smallBtn, { backgroundColor: C.blueBg }]}>
                    <Text style={[s.smallBtnGhostText, { color: C.blue }]}>Working on it</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          <View style={s.chipRow}>
            {Object.entries(lists).map(([key, l]) => (
              <Pressable key={key} style={[s.chip, listKey === key && s.chipActive]} onPress={() => setListKey(key)}>
                <Text style={[s.chipText, listKey === key && s.chipTextActive]}>
                  {l.label} · {l.total}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={s.card}>
            {list.items.length === 0 ? (
              <Text style={s.muted}>
                {listKey === 'todo'
                  ? 'No repairs assigned right now. Pull down to refresh.'
                  : listKey === 'awaiting'
                  ? 'Nothing waiting for the GSO.'
                  : 'Nothing completed yet.'}
              </Text>
            ) : list.completed ? (
              list.items.map((r, i, arr) => (
                <View key={r.id} style={[s.listRow, i === arr.length - 1 && s.listRowLast]}>
                  <View style={s.flex}>
                    <Text style={s.listCode}>{r.equipment_code}</Text>
                    <Text style={s.listMeta}>{r.description}</Text>
                    <Text style={s.listMeta}>{formatDateTime(r.completed_date)}</Text>
                  </View>
                  <View style={[s.tag, s.tagGreen]}>
                    <Text style={[s.tagText, { color: C.green }]}>Done</Text>
                  </View>
                </View>
              ))
            ) : (
              list.items.map((j, i, arr) => (
                <Pressable
                  key={j.id}
                  style={[s.listRow, i === arr.length - 1 && s.listRowLast]}
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
            {list.total > list.items.length && (
              <Text style={[s.sectionHint, { marginTop: 8, marginBottom: 0 }]}>
                Showing the {list.items.length} most recent of {list.total}.
              </Text>
            )}
          </View>
        </>
      ) : null}
    </KeyboardScroll>
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
      `Confirm that ${job.equipment_code} has been repaired. The job will be closed and recorded in your summary automatically.`,
      'Mark repaired',
      () => apply('repaired')
    )
  }

  return (
    <KeyboardScroll
      contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
    >
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
              Marked as repaired. This job has been completed automatically.
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
    </KeyboardScroll>
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
      // On success this screen closes, so only reset `looking` on failure.
      onFound(await findEquipmentByQrCode(code))
    } catch (err) {
      setError(err.message)
      setLooking(false)
    }
  }

  return (
    <KeyboardScroll contentContainerStyle={s.scroll}>
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
    </KeyboardScroll>
  )
}

/* ------------------------------------------------------------------ */
/* What the scan reveals                                               */
/* ------------------------------------------------------------------ */

function EquipmentDetail({ equipment, canInspect = true, onInspect, onCancel }) {
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
        <Row
          label="Expiration"
          value={equipment.expiration_date ? formatYmd(equipment.expiration_date) : 'Not applicable'}
        />
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
        ) : !canInspect ? null : (
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
    <KeyboardScroll contentContainerStyle={s.scroll}>
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
                onPress={() => {
                  // Don't carry over the action/priority of a preset picked
                  // before — a custom finding starts from neutral defaults
                  // and the override rows open so the inspector sets them.
                  setSelectedFinding(OTHER_FINDING)
                  setActionType('other')
                  setPriority('medium')
                  setShowOverrides(true)
                }}
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
    </KeyboardScroll>
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
  headerLogo: { width: 36, height: 36 },
  brandScan: { color: C.flame },
  loginBrand: { alignItems: 'center', marginBottom: 18 },
  loginLogo: { width: 72, height: 72, marginBottom: 6 },
  loginBrandName: { fontSize: 28, fontWeight: '800', color: C.navy },
  loginTagline: { fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 2 },

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
  hero: {
    backgroundColor: C.navy,
    borderRadius: 14,
    padding: 18,
    marginBottom: 14
  },
  heroGreeting: { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
  heroName: { color: C.white, fontSize: 22, fontWeight: '800', marginTop: 2 },
  heroDate: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4 },
  heroLine: {
    color: C.white,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)'
  },

  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  quickBtn: { flex: 1, borderRadius: 12, paddingVertical: 18, alignItems: 'center' },
  quickBtnOutline: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border },
  quickIcon: { fontSize: 24, color: C.white, marginBottom: 4 },
  quickText: { color: C.white, fontSize: 15, fontWeight: '700' },

  dashGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  dashTile: {
    flexBasis: '45%',
    flexGrow: 1,
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    paddingHorizontal: 6,
    alignItems: 'center'
  },
  dashTileValue: { fontSize: 24, fontWeight: '800', color: C.text },
  dashTileLabel: { fontSize: 11, color: C.muted, marginTop: 3, textAlign: 'center' },
  statActive: { borderColor: C.blue, borderWidth: 2, backgroundColor: C.blueBg },

  // "My inspections" / "My jobs": the same numbers as the person's web card
  miniStats: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border
  },
  miniStat: { minWidth: 52 },
  miniStatValue: { fontSize: 22, fontWeight: '800', color: C.text },
  miniStatLabel: { fontSize: 12, color: C.muted, marginTop: 1 },

  availCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  availLabel: { fontSize: 12, color: C.muted, fontWeight: '600' },
  availValue: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  availHint: { fontSize: 12, color: C.muted, marginTop: 2 },

  jobOrder: {
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 4,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    backgroundColor: C.white
  },
  jobOrderTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobOrderLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  jobOrderBar: { height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden', marginTop: 6, marginBottom: 4, flexDirection: 'row' },
  overviewRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border },
  jobOrderToggle: { fontSize: 13, fontWeight: '700', color: C.blue, marginTop: 6 },

  // Unavailable dates calendar
  calHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calWeekday: { width: '14.28%', textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.muted, paddingVertical: 4 },
  calCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
  calSaved: { backgroundColor: C.red },
  calPicked: { backgroundColor: C.blue },
  calToday: { borderColor: C.navy },
  calDayText: { fontSize: 14, color: C.text },

  seeAll: { fontSize: 14, fontWeight: '700', color: C.blue, textAlign: 'center', paddingTop: 12 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },

  nextJobActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  smallBtn: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  smallBtnGhost: { borderWidth: 1, borderColor: C.border, backgroundColor: C.white },
  smallBtnGhostText: { fontSize: 14, fontWeight: '700', color: C.text },
  smallBtnPrimary: { backgroundColor: C.blue },
  smallBtnPrimaryText: { fontSize: 14, fontWeight: '700', color: C.white },

  splitBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: C.border,
    marginTop: 8
  },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  legend: { fontSize: 12, fontWeight: '700' },

  nextJob: { borderLeftWidth: 5, borderLeftColor: C.blue },
  nextJobLabel: { fontSize: 11, fontWeight: '800', color: C.blue, letterSpacing: 0.6 },
  nextJobLink: { fontSize: 14, fontWeight: '700', color: C.blue, marginTop: 10 },

  /* bottom navigation */
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.white,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 8,
    paddingBottom: 6
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  // Center Scan button: a little larger than the other tabs and raised.
  scanTabBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: C.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
    borderWidth: 4,
    borderColor: C.white,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }
  },
  scanTabIcon: { fontSize: 22, color: C.white },
  tabIcon: { fontSize: 20, color: C.muted, textAlign: 'center' },
  tabLabel: { fontSize: 11, color: C.muted, marginTop: 2, fontWeight: '600' },
  tabLabelActive: { color: C.blue, fontWeight: '800' },

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
