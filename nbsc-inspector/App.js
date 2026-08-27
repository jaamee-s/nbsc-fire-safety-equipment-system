import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'

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
  getStoredInspectorName,
  saveInspectorName,
  submitInspection
} from './lib/inspector'

const C = {
  navy: '#0F2A4A',
  navyDark: '#0A1D33',
  blue: '#2563EB',
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
  // 'loading' | 'name' | 'scan' | 'detail' | 'form' | 'done'
  const [screen, setScreen] = useState('loading')
  const [inspectorName, setInspectorName] = useState('')
  const [equipment, setEquipment] = useState(null)
  const [lastResult, setLastResult] = useState(null)

  useEffect(() => {
    getStoredInspectorName().then((name) => {
      if (name) {
        setInspectorName(name)
        setScreen('scan')
      } else {
        setScreen('name')
      }
    })
  }, [])

  function handleNameSaved(name) {
    setInspectorName(name)
    setScreen('scan')
  }

  function handleFound(item) {
    setEquipment(item)
    setScreen('detail')
  }

  function handleSubmitted(result) {
    setLastResult(result)
    setScreen('done')
  }

  function backToScan() {
    setEquipment(null)
    setLastResult(null)
    setScreen('scan')
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.navy} />

      <View style={s.header}>
        <Text style={s.headerTitle}>NBSC Fire Safety</Text>
        <Text style={s.headerSub}>
          {inspectorName ? `Inspector: ${inspectorName}` : 'Equipment Inspection'}
        </Text>
      </View>

      {screen === 'loading' && (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.blue} />
        </View>
      )}

      {screen === 'name' && <NameSetup onSaved={handleNameSaved} />}

      {screen === 'scan' && <ScanScreen onFound={handleFound} />}

      {screen === 'detail' && (
        <EquipmentDetail
          equipment={equipment}
          onInspect={() => setScreen('form')}
          onCancel={backToScan}
        />
      )}

      {screen === 'form' && (
        <InspectionForm
          equipment={equipment}
          inspectorName={inspectorName}
          onSubmitted={handleSubmitted}
          onCancel={() => setScreen('detail')}
        />
      )}

      {screen === 'done' && (
        <DoneScreen result={lastResult} equipment={equipment} onNext={backToScan} />
      )}
    </SafeAreaView>
  )
}

/* ------------------------------------------------------------------ */
/* First launch: who is using this device?                             */
/* ------------------------------------------------------------------ */

function NameSetup({ onSaved }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const saved = await saveInspectorName(name)
      onSaved(saved)
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
/* Scan or type an equipment code                                      */
/* ------------------------------------------------------------------ */

function ScanScreen({ onFound }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [looking, setLooking] = useState(false)

  async function lookup(value) {
    setError(null)
    setLooking(true)
    try {
      const item = await findEquipmentByQrCode(value)
      setCode('')
      onFound(item)
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
          <Text style={s.h1}>Find equipment</Text>
          <Text style={s.muted}>
            Scanning is added in the next step, once camera testing is possible.
            For now, type the code printed under the QR sticker.
          </Text>

          <Text style={s.label}>Equipment code</Text>
          <TextInput
            style={[s.input, s.inputCode]}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="FE-001"
            autoCapitalize="characters"
            autoCorrect={false}
            onSubmitEditing={() => code.trim() && lookup(code)}
            returnKeyType="search"
          />

          {error && <Text style={s.error}>{error}</Text>}

          <Pressable
            style={[s.btn, s.btnPrimary, (looking || !code.trim()) && s.btnDisabled]}
            onPress={() => lookup(code)}
            disabled={looking || !code.trim()}
          >
            <Text style={s.btnPrimaryText}>{looking ? 'Looking up...' : 'Find Equipment'}</Text>
          </Pressable>

          <Text style={s.hint}>
            Manual entry stays in the finished app. Stickers get scratched, faded or
            painted over, and an inspector standing in front of an unreadable label
            still needs a way through.
          </Text>
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
            {isActive ? 'Active' : STATUS_LABELS[equipment.current_status] || equipment.current_status}
          </Text>
        </View>

        <Row label="Building" value={equipment.buildings?.building_name ?? '—'} />
        <Row label="Location" value={equipment.exact_location ?? '—'} />
        <Row
          label="Expiration"
          value={equipment.expiration_date ?? 'Not applicable'}
        />
        {equipment.description ? (
          <Row label="Notes" value={equipment.description} />
        ) : null}

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

  // Choosing a finding sets what it implies. Both stay overridable, but
  // the override rows stay collapsed so the fast path is: finding, submit.
  function pickFinding(preset) {
    setSelectedFinding(preset.label)
    setActionType(preset.action)
    setPriority(preset.priority)
    setShowOverrides(false)
  }

  const findingsText = isOther ? otherText : selectedFinding || ''

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

  const canSubmit = condition === 'functional' || (defective && findingsText.trim())

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
              <Text
                style={[s.choiceText, condition === 'functional' && s.choiceTextActive]}
              >
                Functional
              </Text>
            </Pressable>
            <Pressable
              style={[s.choice, defective && s.choiceRed]}
              onPress={() => setCondition('defective')}
            >
              <Text style={[s.choiceText, defective && s.choiceTextActive]}>
                Defective
              </Text>
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

function DoneScreen({ result, equipment, onNext }) {
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
          <Text style={s.btnPrimaryText}>Inspect Another</Text>
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
  scroll: { padding: 16, paddingBottom: 40 },

  header: {
    backgroundColor: C.navy,
    paddingHorizontal: 18,
    paddingVertical: 14
  },
  headerTitle: { color: C.white, fontSize: 18, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },

  card: {
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18
  },

  h1: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 6 },
  muted: { fontSize: 14, color: C.muted, lineHeight: 20 },
  hint: { fontSize: 12, color: C.muted, marginTop: 14, lineHeight: 17 },

  code: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: 0.5 },
  type: { fontSize: 15, color: C.muted, marginTop: 2, marginBottom: 10 },

  label: {
    fontSize: 13,
    fontWeight: '700',
    color: C.muted,
    marginTop: 18,
    marginBottom: 6
  },

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
  inputCode: { fontSize: 22, fontWeight: '700', letterSpacing: 2, textAlign: 'center' },
  textarea: { minHeight: 78, textAlignVertical: 'top' },

  error: { color: C.red, fontSize: 14, marginTop: 12 },

  btn: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16
  },
  btnPrimary: { backgroundColor: C.blue },
  btnPrimaryText: { color: C.white, fontSize: 16, fontWeight: '700' },
  btnGhost: { backgroundColor: 'transparent', paddingVertical: 12, marginTop: 6 },
  btnGhostText: { color: C.muted, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },

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
  autoChange: {
    fontSize: 13,
    color: C.blue,
    fontWeight: '600',
    marginTop: 10
  },

  findingWrap: { gap: 8 },
  finding: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 15,
    backgroundColor: C.white
  },
  findingActive: { borderColor: C.blue, borderWidth: 2, backgroundColor: '#EAF1FF' },
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