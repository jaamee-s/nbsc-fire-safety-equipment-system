import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

import {
  ACTION_TYPES,
  ACTION_TYPE_LABELS,
  FINDINGS_BY_TYPE,
  OTHER_FINDING,
  PRIORITY_OPTIONS,
  STATUS_LABELS,
  TYPE_LABELS,
  daysUntil,
  findEquipmentByQrCode,
  getInspectorDashboard,
  getStoredInspectorName,
  relativeTime,
  saveInspectorName,
  submitInspection
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

export default function App() {
  return (
    <SafeAreaProvider>
      <RootApp />
    </SafeAreaProvider>
  )
}

function RootApp() {
  // 'loading' | 'name' | 'home' | 'scan' | 'manual' | 'detail' | 'form' | 'done'
  const [screen, setScreen] = useState('loading')
  const [inspectorName, setInspectorName] = useState('')
  const [equipment, setEquipment] = useState(null)
  const [lastResult, setLastResult] = useState(null)

  useEffect(() => {
    getStoredInspectorName().then((name) => {
      if (name) {
        setInspectorName(name)
        setScreen('home')
      } else {
        setScreen('name')
      }
    })
  }, [])

  function handleFound(item) {
    setEquipment(item)
    goToScreen('detail')
  }

  function goHome() {
    setEquipment(null)
    setLastResult(null)
    goToScreen('home')
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

  // The scan screen wants its own full-bleed handling (camera behind the
  // status bar, footer padded to the gesture bar) so it manages its own
  // insets instead of sharing the app-wide SafeAreaView.
  const isFullBleedScreen = screen === 'scan'

  return (
    <SafeAreaView
      style={s.safe}
      edges={isFullBleedScreen ? [] : ['top', 'left', 'right', 'bottom']}
    >
      <StatusBar barStyle="light-content" backgroundColor={C.navy} />

      {!isFullBleedScreen && (
        <View style={s.header}>
          <Text style={s.headerTitle}>NBSC Fire Safety</Text>
          <Text style={s.headerSub}>
            {inspectorName ? `Inspector: ${inspectorName}` : 'Equipment Inspection'}
          </Text>
        </View>
      )}

      {screen === null && <View style={s.center} />}

      {screen === 'loading' && (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.blue} />
        </View>
      )}

      {screen === 'name' && (
        <NameSetup
          onSaved={(name) => {
            setInspectorName(name)
            setScreen('home')
          }}
        />
      )}

      {screen === 'home' && (
        <HomeScreen
          inspectorName={inspectorName}
          onScan={() => setScreen('scan')}
          onManual={() => setScreen('manual')}
          onOpenEquipment={handleFound}
        />
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
          inspectorName={inspectorName}
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
/* First launch                                                        */
/* ------------------------------------------------------------------ */

function NameSetup({ onSaved }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setError(null)
    setSaving(true)
    try {
      onSaved(await saveInspectorName(name))
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
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.card}>
          <Text style={s.h1}>Welcome</Text>
          <Text style={s.muted}>
            Enter your name once. It will be attached to every inspection you submit,
            so GSO knows who checked each unit.
          </Text>

          <Text style={s.label}>Your full name</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Juan Dela Cruz"
            autoCapitalize="words"
          />

          {error && <Text style={s.error}>{error}</Text>}

          <Pressable
            style={[s.btn, s.btnPrimary, saving && s.btnDisabled]}
            onPress={save}
            disabled={saving}
          >
            <Text style={s.btnPrimaryText}>{saving ? 'Saving...' : 'Continue'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

/* ------------------------------------------------------------------ */
/* Inspector dashboard                                                 */
/* ------------------------------------------------------------------ */

function HomeScreen({ inspectorName, onScan, onManual, onOpenEquipment }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await getInspectorDashboard(inspectorName))
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [inspectorName])

  useEffect(() => {
    load()
  }, [load])

  async function openFromDue(code) {
    try {
      onOpenEquipment(await findEquipmentByQrCode(code))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <ScrollView
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Pressable style={s.scanCta} onPress={onScan}>
        <Text style={s.scanCtaIcon}>▣</Text>
        <Text style={s.scanCtaText}>Scan QR Code</Text>
        <Text style={s.scanCtaSub}>Point the camera at the sticker</Text>
      </Pressable>

      <Pressable style={[s.btn, s.btnOutline]} onPress={onManual}>
        <Text style={s.btnOutlineText}>Enter code manually</Text>
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
            <Stat value={data.today_count} label="Today" />
            <Stat value={data.week_count} label="This week" />
            <Stat value={data.defect_count} label="Defects found" alert />
          </View>

          <Text style={s.sectionTitle}>Due for inspection</Text>
          <Text style={s.sectionHint}>Longest since last check — start here.</Text>
          <View style={s.card}>
            {(data.due || []).length === 0 ? (
              <Text style={s.muted}>No equipment registered yet.</Text>
            ) : (
              data.due.map((d, i) => (
                <Pressable
                  key={d.id}
                  style={[s.listRow, i === data.due.length - 1 && s.listRowLast]}
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
                  <Text
                    style={[
                      s.listWhen,
                      !d.last_inspected && { color: C.red, fontWeight: '700' }
                    ]}
                  >
                    {relativeTime(d.last_inspected)}
                  </Text>
                </Pressable>
              ))
            )}
          </View>

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

function Stat({ value, label, alert }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, alert && value > 0 && { color: C.red }]}>
        {value ?? 0}
      </Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
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

  // Before the footer has measured itself, estimate; once it reports its
  // real height via onLayout below, this becomes exact. Either way it's a
  // real number, not a flex percentage — that's what fixes the sizing bug.
  const cameraAreaHeight =
    footerHeight > 0 ? windowHeight - footerHeight : Math.round(windowHeight * 0.72)

  // The camera fires this repeatedly while a code is in frame, so `busy`
  // guards against firing a dozen lookups for one sticker.
  async function handleScan({ data }) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onFound(await findEquipmentByQrCode(data))
    } catch (err) {
      setError(err.message)
      setTimeout(() => setBusy(false), 1500)
    }
  }

  if (!permission) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={C.blue} />
      </View>
    )
  }

  if (!permission.granted) {
    return (
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }
        ]}
      >
        <View style={s.card}>
          <Text style={s.h1}>Camera access needed</Text>
          <Text style={s.muted}>
            The app uses the camera only to read equipment QR stickers. No photos are
            taken or uploaded.
          </Text>
          <Pressable style={[s.btn, s.btnPrimary]} onPress={requestPermission}>
            <Text style={s.btnPrimaryText}>Allow Camera</Text>
          </Pressable>
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
        <Pressable style={[s.btn, s.btnOutlineLight]} onPress={onManual}>
          <Text style={s.btnOutlineLightText}>Enter code manually</Text>
        </Pressable>
        <Pressable style={[s.btn, s.btnGhost]} onPress={onCancel}>
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
  const expired = left !== null && left < 0
  const expiringSoon = left !== null && left >= 0 && left <= 30
  const isActive = equipment.current_status === 'active'

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <View style={s.card}>
        <Text style={s.code}>{equipment.equipment_code}</Text>
        <Text style={s.type}>
          {TYPE_LABELS[equipment.equipment_type] || equipment.equipment_type}
        </Text>

        <View style={[s.pill, isActive ? s.pillGreen : s.pillRed]}>
          <Text style={[s.pillText, { color: isActive ? C.green : C.red }]}>
            {isActive
              ? 'Active'
              : STATUS_LABELS[equipment.current_status] || equipment.current_status}
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

        <Pressable style={[s.btn, s.btnPrimary]} onPress={onInspect}>
          <Text style={s.btnPrimaryText}>Start Inspection</Text>
        </Pressable>

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

function InspectionForm({ equipment, inspectorName, onSubmitted, onCancel }) {
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
        findings: findingsText,
        inspectionNotes: notes,
        actionType,
        priority,
        inspectorName
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
              ? 'GSO has been notified. This unit now appears in their Priority Actions.'
              : 'No action needed. The unit is marked active.'}
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

  header: { backgroundColor: C.navy, paddingHorizontal: 18, paddingVertical: 14 },
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