import { Fragment, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from './supabaseClient'
import Login from './Login'
import logoMarkDarkBg from './assets/logo-mark-dark-bg.svg'
import {
  AccountSettingsModal,
  NotificationBell,
  PasswordInput,
  PriorityActionsSummary,
  SummaryModal,
  AvailabilityModal,
  CalendarButton,
  InspectorsTab,
  JobOrderRequestModal,
  LeaveLine,
  ReplacementNote
} from './GsoExtras'
import { buildGsoNotifications, findPurchaseRequestItems, needsReplacementUnit } from './gsoNotifications'
import { accountErrorMessage, checkAccountFields, USERNAME_HINT } from './staffAccounts'
// StatusDonut (pie chart) is hidden for now — see the dashboard graphs.
import { InspectionWeeks, TypeBars } from './DashboardCharts'
import { ReportsTab } from './ReportsTab'
import { ACTION_STATUS_LABELS, buildInventoryReport, manilaDay } from './reports'
import nbscHeader from './assets/nbsc-print-header.png'

// The print dialog opens a moment after a report sheet is drawn; load the
// letterhead now so it is never missing from the first printout.
if (typeof window !== 'undefined') new Image().src = nbscHeader

const HINT_STYLE = { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '5px 0 0 0' }

const EQUIPMENT_TYPES = [
  'fire_extinguisher',
  'fire_alarm',
  'sprinkler',
  'emergency_light',
  'smoke_detector'
]

const STATUS_OPTIONS = [
  'functional',
  'defective',
  'for_repair',
  'for_replacement',
  'expired',
  'no_longer_in_service'
]

const PRIORITY_ORDER = { critical: 1, high: 2, medium: 3, low: 4 }

// Decision support on Equipment cards: a unit that is functional again after
// a low/medium-priority defect gets a follow-up recommendation, based on the
// kind of work that fixed it.
const LOW_RISK_PRIORITIES = ['low', 'medium']
const RECOMMENDATION_BY_ACTION = {
  repair: 'check that the repair is holding at the next inspection.',
  replace: 'check that the new unit is working at the next inspection.',
  battery_replacement: 'test the battery at the next inspection.',
  refill: 'check the pressure gauge at the next inspection.',
  inspection: 'inspect this unit again at the next scheduled round.',
  other: 're-check the reported problem at the next inspection.'
}

const TYPE_LABELS = {
  fire_extinguisher: 'Fire Extinguisher',
  fire_alarm: 'Fire Alarm',
  sprinkler: 'Sprinkler',
  emergency_light: 'Emergency Light',
  smoke_detector: 'Smoke Detector'
}

const STATUS_LABELS = {
  functional: 'Functional',
  defective: 'Defective',
  for_repair: 'For Repair',
  for_replacement: 'Needs New Unit',
  expired: 'Expired',
  no_longer_in_service: 'No Longer in Service'
}

// Work types. "Replace whole unit" = the entire unit is swapped for a new
// one; fixing a part (battery, bulb, nozzle) or refilling is not a
// replacement. Same labels as the mobile app.
const ACTION_LABELS = {
  repair: 'Repair',
  replace: 'Replace whole unit',
  battery_replacement: 'Battery Replacement',
  refill: 'Refill',
  inspection: 'Inspection',
  other: 'Other'
}

const CODE_PREFIXES = {
  fire_extinguisher: 'FE',
  fire_alarm: 'FA',
  sprinkler: 'SR',
  emergency_light: 'EL',
  smoke_detector: 'SD'
}

// GSO's action on a reported defect is a Job Order Request (see the Job
// Order Request modal). When the fix needs a replacement unit that the
// storeroom doesn't have, the unit also needs a Purchase Request; the
// Supply Office processes it, and the dashboard lists every such unit in the
// Priority Actions summary (see findPurchaseRequestItems).

// "Others" in the Add Equipment form: a custom type is stored by the name the
// admin typed (e.g. "Fire Hose Reel"), so it reads correctly everywhere.
const OTHER_TYPE = '__other__'

function typeLabel(type) {
  return TYPE_LABELS[type] || type
}

// Code prefix for a type. Built-in types have fixed ones; a custom type uses
// its initials ("Fire Hose Reel" -> FHR, "Hydrant" -> HY).
function codePrefixFor(equipmentType) {
  if (CODE_PREFIXES[equipmentType]) return CODE_PREFIXES[equipmentType]
  const words = String(equipmentType || '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return 'EQ'
  const prefix =
    words.length === 1 ? words[0].slice(0, 2) : words.map((w) => w[0]).join('').slice(0, 4)
  return prefix.toUpperCase()
}

async function generateEquipmentCode(supabase, equipmentType) {
  const prefix = codePrefixFor(equipmentType)

  const { data, error } = await supabase
    .from('equipment')
    .select('equipment_code')
    .ilike('equipment_code', `${prefix}-%`)

  if (error) {
    console.error('Error generating equipment code:', error)
    return `${prefix}-001`
  }

  let maxNumber = 0
  data.forEach((row) => {
    const match = row.equipment_code?.match(/-(\d+)$/)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > maxNumber) maxNumber = num
    }
  })

  const nextNumber = maxNumber + 1
  return `${prefix}-${String(nextNumber).padStart(3, '0')}`
}

// True when both dates are filled in and expiry comes before installation.
// Both are 'YYYY-MM-DD' strings, which compare correctly as text.
function datesOutOfOrder(installationDate, expirationDate) {
  return !!installationDate && !!expirationDate && expirationDate < installationDate
}

function daysAgo(dateString) {
  if (!dateString) return null
  const then = new Date(dateString)
  const now = new Date()
  return Math.floor((now - then) / (1000 * 60 * 60 * 24))
}

// Full date + clock time, in the viewer's local timezone.
// inspection_date is stored as timestamptz, so the exact moment of submission survives.
function formatTimestamp(dateString) {
  if (!dateString) return '—'
  // A date with no time (YYYY-MM-DD) shows the date only, not a made-up time.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString))
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }
  return new Date(dateString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function relativeTime(dateString) {
  if (!dateString) return ''
  const diffMs = new Date() - new Date(dateString)
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

/**
 * A printable sticker for one piece of equipment.
 *
 * The QR encodes ONLY the equipment code — never the location or expiry.
 * Those change over the unit's life; the sticker cannot. The scanner uses
 * the code to look the record up live, so a sticker printed today stays
 * accurate after the unit is moved, refilled, or re-inspected.
 */
function QrLabel({ item }) {
  return (
    <div className="qr-label">
      <QRCodeSVG value={item.qr_code || item.equipment_code} size={110} level="M" />
      <div className="qr-label-text">
        <div className="qr-label-code">{item.equipment_code}</div>
        <div className="qr-label-type">{TYPE_LABELS[item.equipment_type] || item.equipment_type}</div>
        <div className="qr-label-loc">
          {item.buildings?.building_name ?? '—'}
          <br />
          {item.exact_location}
        </div>
        <div className="qr-label-foot">NBSC Fire Safety · Scan to inspect</div>
      </div>
    </div>
  )
}

// Sidebar: navigation only, grouped under small headings.
const SIDEBAR_GROUPS = [
  { title: 'Main', items: [{ tab: 'dashboard', label: 'Dashboard' }] },
  { title: 'Manage', items: [{ tab: 'buildings', label: 'Buildings' }, { tab: 'stock', label: 'Stock' }] },
  { title: 'People', items: [{ tab: 'inspectors', label: 'Inspectors' }, { tab: 'technicians', label: 'Technicians' }] },
  { title: 'Reports', items: [{ tab: 'reports', label: 'Reports' }] }
]

// One outline icon style for every sidebar item.
function NavIcon({ name }) {
  const paths = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
      </>
    ),
    buildings: (
      <>
        <path d="M4 21V5l8-3 8 3v16" />
        <path d="M9 21v-5h6v5" />
        <path d="M8 8h1M15 8h1M8 12h1M15 12h1" />
      </>
    ),
    stock: (
      <>
        <path d="M3 7l9-4 9 4-9 4-9-4z" />
        <path d="M3 7v10l9 4 9-4V7" />
        <path d="M12 11v10" />
      </>
    ),
    inspectors: (
      <>
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4.5-4.5" />
      </>
    ),
    technicians: <path d="M14.5 5.5a4 4 0 0 0 4.9 4.9L21 12l-9 9-3-3 9-9-1.6-1.6a4 4 0 0 1-4.9-4.9z" />,
    reports: (
      <>
        <path d="M6 2h9l5 5v15H6z" />
        <path d="M14 2v6h6" />
        <path d="M9 13h7M9 17h7" />
      </>
    )
  }
  return (
    <svg className="side-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [showLoginSuccess, setShowLoginSuccess] = useState(false)

  useEffect(() => {
    // Supabase also fires an auth event on every token refresh (about hourly)
    // and when the tab regains focus. Reloading the profile then would flash
    // the loading screen and remount the dashboard, wiping the GSO's open
    // tab and half-filled forms — so only load when the user actually changes.
    let loadedFor = null

    async function loadProfile(userId) {
      if (loadedFor === userId) return
      loadedFor = userId
      setAuthLoading(true)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('Error loading profile:', error)
        loadedFor = null // allow a retry on the next auth event
      } else {
        setProfile(data)
      }
      setAuthLoading(false)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else setAuthLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadProfile(session.user.id)
      else {
        loadedFor = null
        setProfile(null)
        setAuthLoading(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  if (!session) {
    return <Login onLoginSuccess={() => setShowLoginSuccess(true)} />
  }

  const successModal = showLoginSuccess ? (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-title">Login Successful</div>
        <p className="modal-message">
          Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}. You are now signed in
          to the NBSC Fire Safety Equipment System.
        </p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => setShowLoginSuccess(false)}>
            OK
          </button>
        </div>
      </div>
    </div>
  ) : null

  if (authLoading) {
    return (
      <>
        {successModal}
        <div className="login-wrap">
          <p style={{ color: '#fff' }}>Loading...</p>
        </div>
      </>
    )
  }

  if (!profile) {
    return (
      <>
        {successModal}
        <div className="login-wrap">
          <div className="login-card">
            <h1>No profile found</h1>
            <p className="login-subtitle">
              Your account isn't linked to a profile yet. Ask your Admin to add you to the
              profiles table.
            </p>
            <button className="btn btn-secondary" style={{ marginTop: '16px' }} onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </>
    )
  }

  if (profile.role === 'inspector' || profile.role === 'technician') {
    return (
      <>
        {successModal}
        <div className="login-wrap">
          <div className="login-card">
            <h1>{profile.role === 'technician' ? 'Technician Account' : 'Inspector Account'}</h1>
            <p className="login-subtitle">
              {profile.role === 'technician'
                ? 'Repair work is handled in the FireScan mobile app. Please sign in there to see your assigned equipment and update repair status.'
                : 'Inspections are performed in the FireScan mobile app. Please sign in there to scan equipment and submit inspections.'}
            </p>
            <button className="btn btn-secondary" style={{ marginTop: '16px' }} onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {successModal}
      <Dashboard profile={profile} onLogout={handleLogout} />
    </>
  )
}

function Dashboard({ profile, onLogout }) {
  const [equipment, setEquipment] = useState([])
  const [buildings, setBuildings] = useState([])
  const [maintenanceActions, setMaintenanceActions] = useState([])
  // Completed (closed) jobs, loaded separately so they can appear in the Summary.
  const [completedActions, setCompletedActions] = useState([])
  // Every job ever filed (open and closed, no limit): the Repairs report and
  // the Assigned / Working / Completed numbers on the Technician cards.
  const [allActions, setAllActions] = useState([])
  // Unavailable dates sent by inspectors / technicians (migration 012)
  const [unavailability, setUnavailability] = useState([])
  // Available / Unavailable switches made on the phone (migration 017)
  const [availabilityChanges, setAvailabilityChanges] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const [form, setForm] = useState({
    equipment_code: '',
    equipment_type: EQUIPMENT_TYPES[0],
    building_id: '',
    exact_location: '',
    qr_code: '',
    installation_date: '',
    expiration_date: '',
    current_status: 'functional',
    description: ''
  })

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState(null)

  const [actionUpdatingId, setActionUpdatingId] = useState(null)

  // Which top-level tab is showing — replaces the old single long-scroll
  // page with Dashboard / Buildings / Equipment sections.
  const [activeTab, setActiveTab] = useState('dashboard')
  // Which Priority Action card is expanded to show its full equipment
  // detail and inspection history inline.
  const [expandedActionId, setExpandedActionId] = useState(null)
  // Holds the retired unit's type/location right after a fire extinguisher
  // action completes, so we can suggest — not silently create — its
  // replacement, pre-filled with the same spot and a 2-year default
  // expiration. GSO still confirms and can edit afterward.
  const [replacementPrompt, setReplacementPrompt] = useState(null)

  // Inspection history state
  const [inspections, setInspections] = useState([])
  const [expandedHistoryId, setExpandedHistoryId] = useState(null)

  // QR label state
  const [expandedQrId, setExpandedQrId] = useState(null)
  const [qrPrintItems, setQrPrintItems] = useState([])

  // Rendering the print sheet has to finish before the print dialog opens,
  // so we trigger printing from an effect rather than inside the click handler.
  useEffect(() => {
    if (qrPrintItems.length === 0) return
    const timer = setTimeout(() => {
      window.print()
      setQrPrintItems([])
    }, 200)
    return () => clearTimeout(timer)
  }, [qrPrintItems])

  // Equipment report: printed the same way as the QR labels (render, then print)
  const [reportPrint, setReportPrint] = useState(null)

  useEffect(() => {
    if (!reportPrint) return
    const timer = setTimeout(() => {
      window.print()
      setReportPrint(null)
    }, 200)
    return () => clearTimeout(timer)
  }, [reportPrint])

  // Equipment search / filter state
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterBuilding, setFilterBuilding] = useState('')

  // Building management state
  const [showBuildingForm, setShowBuildingForm] = useState(false)
  const [buildingForm, setBuildingForm] = useState({ building_name: '', location_description: '' })
  const [buildingSubmitting, setBuildingSubmitting] = useState(false)
  const [buildingError, setBuildingError] = useState(null)
  const [editingBuildingId, setEditingBuildingId] = useState(null)
  const [editBuildingForm, setEditBuildingForm] = useState({})
  const [editBuildingSaving, setEditBuildingSaving] = useState(false)
  const [editBuildingError, setEditBuildingError] = useState(null)

  // Building location (floor/room) management state
  const [buildingLocations, setBuildingLocations] = useState([])
  const [expandedLocationsBuildingId, setExpandedLocationsBuildingId] = useState(null)
  const [locationForm, setLocationForm] = useState({ floor_label: '', location_label: '' })
  const [locationSubmitting, setLocationSubmitting] = useState(false)
  const [locationError, setLocationError] = useState(null)
  const [locationFloorMode, setLocationFloorMode] = useState('select')
  const [bulkForm, setBulkForm] = useState({ floor_label: '', prefix: 'Room ', start: '', end: '' })
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [bulkError, setBulkError] = useState(null)
  const [bulkFloorMode, setBulkFloorMode] = useState('select')
  // Add Single Room: the Bulk form's choices for one room, plus the office
  // in it (e.g. Rm105 - Research Publication Office)
  const [roomForm, setRoomForm] = useState({ floor_label: '', prefix: 'Room ', number: '', office: '' })
  const [roomFloorMode, setRoomFloorMode] = useState('select')
  const [roomSubmitting, setRoomSubmitting] = useState(false)
  const [roomError, setRoomError] = useState(null)

  // Stock tracking state
  const [stock, setStock] = useState([])
  const [stockEdits, setStockEdits] = useState({})
  const [stockSaving, setStockSaving] = useState(false)
  const [stockMessage, setStockMessage] = useState(null)

  // Technician management state
  const [technicians, setTechnicians] = useState([])
  const [showTechnicianForm, setShowTechnicianForm] = useState(false)
  const [technicianForm, setTechnicianForm] = useState({
    full_name: '',
    contact_info: '',
    username: '',
    password: ''
  })
  // Mobile app logins (username shown on cards) and the "account created" note
  const [staffAccounts, setStaffAccounts] = useState([])
  const [accountNotice, setAccountNotice] = useState(null)
  // "Create app account" for a technician added before accounts existed
  const [techLoginFor, setTechLoginFor] = useState(null)
  const [techLoginForm, setTechLoginForm] = useState({ username: '', password: '' })
  const [techLoginSaving, setTechLoginSaving] = useState(false)
  const [techLoginError, setTechLoginError] = useState(null)
  // Which technician's Account settings window is open
  const [accountSettingsFor, setAccountSettingsFor] = useState(null)
  // Which technician's "Assign job order" list is open
  const [jobPickFor, setJobPickFor] = useState(null)
  // Which technician's repair History is open
  const [techHistoryFor, setTechHistoryFor] = useState(null)
  // Filters and page for the repair history window
  const [techHistFilter, setTechHistFilter] = useState({ from: '', to: '', priority: '' })
  const [techHistPage, setTechHistPage] = useState(0)
  // Whose unavailable dates are open (calendar button on a technician card)
  const [calendarFor, setCalendarFor] = useState(null)
  // Which report the Reports page opens on (n changes to reopen it)
  const [reportStart, setReportStart] = useState({ key: 'inventory', n: 0 })
  const [technicianSubmitting, setTechnicianSubmitting] = useState(false)
  const [technicianError, setTechnicianError] = useState(null)
  const [editingTechnicianId, setEditingTechnicianId] = useState(null)
  const [editTechnicianForm, setEditTechnicianForm] = useState({})
  const [editTechnicianSaving, setEditTechnicianSaving] = useState(false)
  const [editTechnicianError, setEditTechnicianError] = useState(null)

  // Outcome modal state (Resolved/Unresolved choice when closing work)
  const [outcomeModal, setOutcomeModal] = useState(null)
  const [outcomeChoice, setOutcomeChoice] = useState('resolved')
  const [outcomeReason, setOutcomeReason] = useState('')

  // Technician assignment modal state (when starting a job order)
  const [techAssignModal, setTechAssignModal] = useState(null)
  // Free-text remarks that go on the Job Order Request form
  const [jobOrderRemarks, setJobOrderRemarks] = useState('')
  const [selectedTechnicianId, setSelectedTechnicianId] = useState('')

  // Add Equipment form: the new unit comes out of the storeroom stock, so the
  // system takes 1 off that type's stock when it is saved.
  const [takeFromStock, setTakeFromStock] = useState(true)

  // Add Equipment form: "Others" — the new equipment type's name
  const [otherTypeName, setOtherTypeName] = useState('')
  const latestOtherNameRef = useRef('')

  // Add Equipment form: cascading location picker state
  const [formFloor, setFormFloor] = useState('')
  const [formLocationChoice, setFormLocationChoice] = useState('')

  // Priority Actions filter ('all', 'pending', 'in_progress', 'unresolved')
  const [priorityFilter, setPriorityFilter] = useState('all')

  // Summary view (header button)
  const [showSummary, setShowSummary] = useState(false)

  // Back to Top button state and listener
  const [showBackToTop, setShowBackToTop] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // True once the first load of everything has finished. Until then the
  // notification bell stays quiet, so what already existed when the page
  // opened doesn't ding — only what arrives afterwards does.
  const [initialLoaded, setInitialLoaded] = useState(false)

  useEffect(() => {
    Promise.allSettled([
      getEquipment(),
      getBuildings(),
      getMaintenanceActions(),
      getBuildingLocations(),
      getInspections(),
      getStock(),
      getTechnicians(),
      getCompletedActions(),
      getAllActions(),
      getStaffAccounts(),
      getUnavailability(),
      getAvailabilityChanges()
    ]).then(() => setInitialLoaded(true))
  }, [])

  // Real-time updates: when a technician marks a repair, an inspector
  // submits a defect or someone sends unavailable dates, the GSO dashboard
  // refreshes by itself and the bell rings, with no need to reload.
  // Three layers, so it keeps working even if one fails:
  //   1. Live channel: Supabase pushes each change the moment it happens.
  //   2. If the channel drops (Wi-Fi blip, laptop asleep), it reconnects
  //      after 5 seconds and catches up on anything missed meanwhile.
  //   3. Safety net: every 20 seconds while the page is open, and whenever
  //      the tab comes back into view, the live data is fetched again.
  useEffect(() => {
    let channel = null
    let retryTimer = null
    let stopped = false

    function refreshLive() {
      getMaintenanceActions()
      getCompletedActions()
      getAllActions()
      getEquipment(true)
      getInspections()
      getTechnicians()
      getUnavailability()
      getAvailabilityChanges()
      getStock()
    }

    function connect() {
      const ch = supabase
        .channel('gso-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_actions' }, () => {
          getMaintenanceActions()
          getCompletedActions()
          getAllActions()
          getEquipment(true)
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inspections' }, () => {
          getInspections()
          getEquipment(true)
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment' }, () => {
          getEquipment(true)
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment_stock' }, () => {
          getStock()
        })
        // A technician changed their availability on the phone (migration 009).
        .on('postgres_changes', { event: '*', schema: 'public', table: 'technicians' }, () => {
          getTechnicians()
        })
        // Someone sent (or removed) unavailable dates from the app (migration 013).
        .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_unavailability' }, () => {
          getUnavailability()
        })
        // Someone switched Available / Unavailable on the phone (migration 017).
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_availability_changes' }, () => {
          getAvailabilityChanges()
        })
      channel = ch
      ch.subscribe((status) => {
        if (stopped || ch !== channel) return
        // Connected (or reconnected): catch up on anything that changed
        // while there was no connection.
        if (status === 'SUBSCRIBED') refreshLive()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          channel = null
          supabase.removeChannel(ch)
          clearTimeout(retryTimer)
          retryTimer = setTimeout(() => {
            if (!stopped) connect()
          }, 5000)
        }
      })
    }

    connect()

    const safetyNet = setInterval(() => {
      if (document.visibilityState === 'visible') refreshLive()
    }, 20000)
    function onBackInView() {
      if (document.visibilityState === 'visible') refreshLive()
    }
    document.addEventListener('visibilitychange', onBackInView)
    window.addEventListener('focus', onBackInView)

    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearInterval(safetyNet)
      document.removeEventListener('visibilitychange', onBackInView)
      window.removeEventListener('focus', onBackInView)
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  // quiet: a background refresh, so the Equipment table does not flash
  // its loading state.
  async function getEquipment(quiet = false) {
    if (!quiet) setLoading(true)
    const { data, error } = await supabase
      .from('equipment')
      .select(`
        id, equipment_code, equipment_type, building_id, exact_location,
        qr_code, installation_date, expiration_date, current_status, description, created_at,
        buildings ( building_name )
      `)
      .order('created_at', { ascending: false })

    if (error) console.error('Error fetching equipment:', error)
    else setEquipment(data)
    setLoading(false)
  }

  async function getBuildings() {
    const { data, error } = await supabase
      .from('buildings')
      .select('id, building_name, location_description')
      .order('building_name', { ascending: true })

    if (error) console.error('Error fetching buildings:', error)
    else setBuildings(data)
  }

  function handleBuildingFormChange(e) {
    const { name, value } = e.target
    setBuildingForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleBuildingSubmit(e) {
    e.preventDefault()
    setBuildingError(null)

    if (!buildingForm.building_name.trim()) {
      setBuildingError('Building name is required.')
      return
    }

    setBuildingSubmitting(true)

    const { error } = await supabase.from('buildings').insert([
      {
        building_name: buildingForm.building_name,
        location_description: buildingForm.location_description || null
      }
    ])

    if (error) {
      console.error('Error inserting building:', error)
      setBuildingError(error.message)
    } else {
      setBuildingForm({ building_name: '', location_description: '' })
      setShowBuildingForm(false)
      getBuildings()
    }

    setBuildingSubmitting(false)
  }

  function startEditBuilding(b) {
    setEditingBuildingId(b.id)
    setEditBuildingError(null)
    setEditBuildingForm({
      building_name: b.building_name || '',
      location_description: b.location_description || ''
    })
  }

  function cancelEditBuilding() {
    setEditingBuildingId(null)
    setEditBuildingForm({})
    setEditBuildingError(null)
  }

  function handleEditBuildingChange(e) {
    const { name, value } = e.target
    setEditBuildingForm((prev) => ({ ...prev, [name]: value }))
  }

  async function saveEditBuilding(id) {
    setEditBuildingSaving(true)
    setEditBuildingError(null)

    if (!editBuildingForm.building_name.trim()) {
      setEditBuildingError('Building name is required.')
      setEditBuildingSaving(false)
      return
    }

    const { error } = await supabase
      .from('buildings')
      .update({
        building_name: editBuildingForm.building_name,
        location_description: editBuildingForm.location_description || null
      })
      .eq('id', id)

    if (error) {
      console.error('Error updating building:', error)
      setEditBuildingError(error.message)
    } else {
      setEditingBuildingId(null)
      setEditBuildingForm({})
      getBuildings()
      getEquipment() // refresh so equipment cards show updated building name
    }

    setEditBuildingSaving(false)
  }

  async function deleteBuilding(id, name) {
    const confirmed = window.confirm(
      `Delete "${name}"? This will fail if any equipment is still assigned to this building.`
    )
    if (!confirmed) return

    const { error } = await supabase.from('buildings').delete().eq('id', id)

    if (error) {
      console.error('Error deleting building:', error)
      alert(
        'Could not delete this building. It likely still has equipment assigned to it. ' +
          'Reassign or remove that equipment first.\n\n' +
          error.message
      )
    } else {
      getBuildings()
    }
  }

  async function getBuildingLocations() {
    const { data, error } = await supabase
      .from('building_locations')
      .select('id, building_id, floor_label, location_label')
      .order('floor_label', { ascending: true })
      .order('location_label', { ascending: true })

    if (error) console.error('Error fetching building locations:', error)
    else setBuildingLocations(data)
  }

  function handleLocationFormChange(e) {
    const { name, value } = e.target
    setLocationForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleLocationSubmit(e, buildingId) {
    e.preventDefault()
    setLocationError(null)

    if (!locationForm.floor_label.trim() || !locationForm.location_label.trim()) {
      setLocationError('Floor and location name are required.')
      return
    }

    setLocationSubmitting(true)

    const { error } = await supabase.from('building_locations').insert([
      {
        building_id: buildingId,
        floor_label: locationForm.floor_label.trim(),
        location_label: locationForm.location_label.trim()
      }
    ])

    if (error) {
      console.error('Error adding location:', error)
      setLocationError(error.message)
    } else {
      setLocationForm({ floor_label: locationForm.floor_label, location_label: '' })
      setLocationFloorMode('select')
      getBuildingLocations()
    }

    setLocationSubmitting(false)
  }

  function handleBulkFormChange(e) {
    const { name, value } = e.target
    setBulkForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleBulkSubmit(e, buildingId) {
    e.preventDefault()
    setBulkError(null)

    const start = parseInt(bulkForm.start, 10)
    const end = parseInt(bulkForm.end, 10)

    if (!bulkForm.floor_label.trim()) {
      setBulkError('Floor is required.')
      return
    }
    if (isNaN(start) || isNaN(end) || start > end) {
      setBulkError('Enter a valid start and end number (start must be less than or equal to end).')
      return
    }
    if (end - start > 200) {
      setBulkError('That range is too large (max 200 at a time).')
      return
    }

    setBulkSubmitting(true)

    const rows = []
    for (let n = start; n <= end; n++) {
      rows.push({
        building_id: buildingId,
        floor_label: bulkForm.floor_label.trim(),
        location_label: `${bulkForm.prefix}${n}`
      })
    }

    const { error } = await supabase.from('building_locations').insert(rows)

    if (error) {
      console.error('Error bulk adding locations:', error)
      setBulkError(error.message)
    } else {
      setBulkForm({ floor_label: bulkForm.floor_label, prefix: bulkForm.prefix, start: '', end: '' })
      setBulkFloorMode('select')
      getBuildingLocations()
    }

    setBulkSubmitting(false)
  }

  function handleRoomFormChange(e) {
    const { name, value } = e.target
    setRoomForm((prev) => ({ ...prev, [name]: value }))
  }

  // One room, named like the Bulk form (prefix + number), with the office
  // that uses it after a dash, the same way the existing rooms are named.
  async function handleRoomSubmit(e, buildingId) {
    e.preventDefault()
    setRoomError(null)

    const floor = roomForm.floor_label.trim()
    const number = roomForm.number.trim()
    const office = roomForm.office.trim()
    if (!floor) {
      setRoomError('Floor is required.')
      return
    }
    if (!number) {
      setRoomError('Room number is required (e.g. 106 or 303-304).')
      return
    }
    const label = `${roomForm.prefix}${number}${office ? ` - ${office}` : ''}`.trim()
    const duplicate = buildingLocations.some(
      (l) =>
        l.building_id === buildingId &&
        l.floor_label.trim().toLowerCase() === floor.toLowerCase() &&
        l.location_label.trim().toLowerCase() === label.toLowerCase()
    )
    if (duplicate) {
      setRoomError(`"${label}" is already on ${floor}.`)
      return
    }

    setRoomSubmitting(true)
    const { error } = await supabase
      .from('building_locations')
      .insert([{ building_id: buildingId, floor_label: floor, location_label: label }])

    if (error) {
      console.error('Error adding room:', error)
      setRoomError(error.message)
    } else {
      setRoomForm({ floor_label: floor, prefix: roomForm.prefix, number: '', office: '' })
      setRoomFloorMode('select')
      getBuildingLocations()
    }
    setRoomSubmitting(false)
  }

  // exact_location on equipment is a copied text string, not a foreign key,
  // so the database can't stop this delete from stranding equipment that
  // still points at this room. We check and warn before deleting instead.
  async function deleteLocation(id, floorLabel, locationLabel) {
    const fullLocation = `${floorLabel} - ${locationLabel}`
    const affected = equipment.filter((e) => e.exact_location === fullLocation)

    const message =
      affected.length > 0
        ? `Delete "${locationLabel}"?\n\n${affected.length} piece${
            affected.length === 1 ? '' : 's'
          } of equipment (${affected
            .map((e) => e.equipment_code)
            .join(', ')}) still list this location. They will keep showing it, ` +
          `but it will no longer be selectable when adding new equipment.\n\nDelete anyway?`
        : `Delete "${locationLabel}"? This cannot be undone.`

    if (!window.confirm(message)) return

    const { error } = await supabase.from('building_locations').delete().eq('id', id)
    if (error) {
      console.error('Error deleting location:', error)
      alert('Failed to delete location: ' + error.message)
    } else {
      getBuildingLocations()
    }
  }

  async function getMaintenanceActions() {
    let { data, error } = await supabase
      .from('maintenance_actions')
      .select(`
        id, action_type, description, priority, status, reported_date, due_date,
        disposition, budget_status, repair_path,
        decided_by, decided_at, completed_by,
        outcome, outcome_reason, outcome_by, outcome_at, assigned_technician_id,
        repair_status, repair_note, repaired_at, job_order_remarks,
        equipment ( id, equipment_code, equipment_type, exact_location, building_id,
          buildings ( building_name )
        )
      `)
      .in('status', ['pending', 'in_progress', 'delayed', 'for_disposal', 'unresolved'])
      .order('reported_date', { ascending: true })

    if (error) {
      // Graceful fallback if the SQL migration has not been run in Supabase yet
      console.warn('Extended columns not found, using base query:', error.message)
      const fallback = await supabase
        .from('maintenance_actions')
        .select(`
          id, action_type, description, priority, status, reported_date, due_date,
          disposition, budget_status, repair_path,
          decided_by, decided_at, completed_by,
          equipment ( id, equipment_code, equipment_type, exact_location, building_id,
            buildings ( building_name )
          )
        `)
        .in('status', ['pending', 'in_progress', 'delayed', 'for_disposal'])
        .order('reported_date', { ascending: true })

      if (fallback.error) {
        console.error('Error fetching maintenance actions:', fallback.error)
      } else {
        setMaintenanceActions(fallback.data || [])
      }
    } else {
      setMaintenanceActions(data || [])
    }
  }

  // Closed jobs (including ones the system closed automatically when the
  // technician marked them repaired). Feeds the "Completed repairs" section
  // of the Summary.
  async function getCompletedActions() {
    const { data, error } = await supabase
      .from('maintenance_actions')
      .select(`
        id, action_type, description, priority, status,
        completed_date, completed_by, outcome_reason,
        equipment ( id, equipment_code, equipment_type, exact_location,
          buildings ( building_name )
        )
      `)
      .eq('status', 'completed')
      .order('completed_date', { ascending: false })
      .limit(100)

    if (error) console.error('Error fetching completed actions:', error)
    else setCompletedActions(data || [])
  }

  async function getUnavailability() {
    const { data, error } = await supabase
      .from('staff_unavailability')
      .select('id, profile_id, start_date, end_date, reason, created_at')
      .order('start_date', { ascending: true })
    // Before migration 012 the table doesn't exist; there is simply nothing.
    if (!error) setUnavailability(data || [])
  }

  // Availability switches from the last 3 days, newest first. Before
  // migration 017 the table doesn't exist; there is simply nothing.
  async function getAvailabilityChanges() {
    const since = new Date(new Date().getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from('staff_availability_changes')
      .select('id, profile_id, is_available, changed_at')
      .gte('changed_at', since)
      .order('changed_at', { ascending: false })
      .limit(200)
    if (!error) setAvailabilityChanges(data || [])
  }

  async function getAllActions() {
    const { data, error } = await supabase
      .from('maintenance_actions')
      .select(`
        id, action_type, description, priority, status, repair_status,
        reported_date, completed_date, assigned_technician_id,
        equipment ( id, equipment_code, equipment_type, exact_location, building_id,
          buildings ( building_name )
        )
      `)
      .order('reported_date', { ascending: false })

    if (error) console.error('Error fetching all actions:', error)
    else setAllActions(data || [])
  }

  async function getStock() {
    const { data, error } = await supabase
      .from('equipment_stock')
      .select('equipment_type, quantity_available, updated_at, updated_by')

    if (error) {
      console.error('Error fetching stock:', error)
    } else {
      setStock(data || [])
      const edits = {}
      ;(data || []).forEach((s) => {
        edits[s.equipment_type] = s.quantity_available
      })
      setStockEdits(edits)
    }
  }

  async function getTechnicians() {
    const { data, error } = await supabase
      .from('technicians')
      .select('id, full_name, contact_info, is_available, profile_id')
      .order('full_name', { ascending: true })

    if (error) {
      console.error('Error fetching technicians:', error)
    } else {
      setTechnicians(data || [])
    }
  }

  async function getInspections() {
    const { data, error } = await supabase
      .from('inspections')
      .select(`
        id, equipment_id, inspection_date, condition_status,
        findings, recommended_action, inspection_notes, action_required,
        inspector_name, inspector_id
      `)
      .order('inspection_date', { ascending: false })

    if (error) console.error('Error fetching inspections:', error)
    else setInspections(data)
  }

  function handleChange(e) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleTypeChange(e) {
    const type = e.target.value
    // A fire extinguisher added here is usually the replacement for one whose
    // job was closed as Resolved — and that already took 1 from stock. So
    // for fire extinguishers the box starts unticked (no double deduction).
    setTakeFromStock(type !== 'fire_extinguisher')
    if (type === OTHER_TYPE) {
      // The code is generated once the new type's name is typed in.
      setOtherTypeName('')
      setForm((prev) => ({ ...prev, equipment_type: OTHER_TYPE, equipment_code: '', qr_code: '' }))
      return
    }
    const newCode = await generateEquipmentCode(supabase, type)
    setForm((prev) => ({
      ...prev,
      equipment_type: type,
      equipment_code: newCode,
      qr_code: newCode
    }))
  }

  // A typed-in type that matches an existing one (e.g. "sprinkler") uses
  // that type instead of creating a duplicate.
  function resolveTypeName(name) {
    const clean = name.trim().replace(/\s+/g, ' ')
    const existing = allTypes.find((t) => typeLabel(t).toLowerCase() === clean.toLowerCase())
    return existing || clean
  }

  async function handleOtherTypeNameChange(e) {
    const name = e.target.value
    setOtherTypeName(name)
    latestOtherNameRef.current = name
    if (!name.trim()) {
      setForm((prev) => ({ ...prev, equipment_code: '', qr_code: '' }))
      return
    }
    const newCode = await generateEquipmentCode(supabase, resolveTypeName(name))
    // Ignore an older lookup that finishes after a newer keystroke.
    if (latestOtherNameRef.current !== name) return
    setForm((prev) => ({ ...prev, equipment_code: newCode, qr_code: newCode }))
  }

  async function openAddForm() {
    const willShow = !showAddForm
    setShowAddForm(willShow)
    if (willShow) setTakeFromStock(form.equipment_type !== 'fire_extinguisher')
    if (willShow && form.equipment_type !== OTHER_TYPE) {
      const newCode = await generateEquipmentCode(supabase, form.equipment_type)
      setForm((prev) => ({ ...prev, equipment_code: newCode, qr_code: newCode }))
    }
  }

  function handleFormBuildingChange(e) {
    const buildingId = e.target.value
    setForm((prev) => ({ ...prev, building_id: buildingId, exact_location: '' }))
    setFormFloor('')
    setFormLocationChoice('')
  }

  function handleFormFloorChange(e) {
    setFormFloor(e.target.value)
    setFormLocationChoice('')
    setForm((prev) => ({ ...prev, exact_location: '' }))
  }

  function handleFormLocationChoiceChange(e) {
    const locationLabel = e.target.value
    setFormLocationChoice(locationLabel)
    setForm((prev) => ({
      ...prev,
      exact_location: locationLabel ? `${formFloor} - ${locationLabel}` : ''
    }))
  }

  // The Buildings section only renders on its own tab, so switch tabs first
  // (before, this only scrolled — to a section that wasn't on the page).
  function jumpToBuildingSetup(buildingId) {
    setExpandedLocationsBuildingId(buildingId)
    setActiveTab('buildings')
    setTimeout(() => {
      document.getElementById('buildings-section')?.scrollIntoView({ behavior: 'smooth' })
    }, 50)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError(null)

    const isOther = form.equipment_type === OTHER_TYPE
    if (isOther && !otherTypeName.trim()) {
      setFormError('Type the name of the new equipment type.')
      return
    }

    if (!form.equipment_code || !form.qr_code || !form.building_id) {
      setFormError('Equipment code, QR code, and building are required.')
      return
    }

    if (!form.exact_location || !formFloor || !formLocationChoice) {
      setFormError('Please select a floor and room/location for this equipment.')
      return
    }

    if (datesOutOfOrder(form.installation_date, form.expiration_date)) {
      setFormError('Expiration date cannot be earlier than the installation date.')
      return
    }

    setSubmitting(true)

    // "Others": save the typed name as the type (reusing an existing type
    // if it matches), with a code made for that type. The database then
    // adds the type to the Stock page automatically.
    let equipmentType = form.equipment_type
    let code = form.equipment_code
    if (isOther) {
      equipmentType = resolveTypeName(otherTypeName)
      code = await generateEquipmentCode(supabase, equipmentType)
    }

    const payload = {
      equipment_code: code,
      equipment_type: equipmentType,
      building_id: form.building_id,
      exact_location: form.exact_location || null,
      qr_code: code,
      installation_date: form.installation_date || null,
      expiration_date: form.expiration_date || null,
      current_status: form.current_status,
      description: form.description || null
    }

    const { error } = await supabase.from('equipment').insert([payload])

    if (error) {
      console.error('Error inserting equipment:', error)
      setFormError(error.message)
    } else {
      // Installed from the storeroom: 1 fewer in stock (a brand-new
      // "Others" type has no stock yet).
      if (takeFromStock && !isOther) await takeOneFromStock(equipmentType)
      setForm({
        equipment_code: '',
        equipment_type: EQUIPMENT_TYPES[0],
        building_id: '',
        exact_location: '',
        qr_code: '',
        installation_date: '',
        expiration_date: '',
        current_status: 'functional',
        description: ''
      })
      setFormFloor('')
      setFormLocationChoice('')
      setOtherTypeName('')
      setShowAddForm(false)
      getEquipment()
      getStock() // a new type now has its own Stock row
    }

    setSubmitting(false)
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditError(null)
    setEditForm({
      equipment_code: item.equipment_code || '',
      equipment_type: item.equipment_type || EQUIPMENT_TYPES[0],
      building_id: item.building_id || '',
      exact_location: item.exact_location || '',
      qr_code: item.qr_code || '',
      installation_date: item.installation_date || '',
      expiration_date: item.expiration_date || '',
      current_status: item.current_status || 'functional',
      description: item.description || ''
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm({})
    setEditError(null)
  }

  function handleEditChange(e) {
    const { name, value } = e.target
    setEditForm((prev) => {
      // A room belongs to one building. Changing the building must clear the
      // old room, or the unit is saved in a room its new building doesn't have.
      if (name === 'building_id' && value !== prev.building_id) {
        return { ...prev, building_id: value, exact_location: '' }
      }
      return { ...prev, [name]: value }
    })
  }

  async function saveEdit(id) {
    setEditSaving(true)
    setEditError(null)

    if (!editForm.equipment_code || !editForm.qr_code || !editForm.building_id) {
      setEditError('Equipment code, QR code, and building are required.')
      setEditSaving(false)
      return
    }

    const buildingHasLocations = buildingLocations.some((l) => l.building_id === editForm.building_id)
    if (buildingHasLocations && !editForm.exact_location) {
      setEditError('Please select the floor and room/location in this building.')
      setEditSaving(false)
      return
    }

    if (datesOutOfOrder(editForm.installation_date, editForm.expiration_date)) {
      setEditError('Expiration date cannot be earlier than the installation date.')
      setEditSaving(false)
      return
    }

    const payload = {
      equipment_code: editForm.equipment_code,
      equipment_type: editForm.equipment_type,
      building_id: editForm.building_id,
      exact_location: editForm.exact_location || null,
      qr_code: editForm.qr_code,
      installation_date: editForm.installation_date || null,
      expiration_date: editForm.expiration_date || null,
      current_status: editForm.current_status,
      description: editForm.description || null
    }

    const { error } = await supabase.from('equipment').update(payload).eq('id', id)

    if (error) {
      console.error('Error updating equipment:', error)
      setEditError(error.message)
    } else {
      setEditingId(null)
      setEditForm({})
      getEquipment()
    }

    setEditSaving(false)
  }

  // Work outcome handler: either Resolved (success) or Unresolved (failed / cannot complete)
  async function handleRecordOutcome(action, choice, reason) {
    if (!action) return
    const actionId = action.id
    const eq = action.equipment
    const isFE = eq?.equipment_type === 'fire_extinguisher'

    setActionUpdatingId(actionId)

    if (choice === 'resolved') {
      const payload = {
        status: 'completed',
        completed_date: new Date().toISOString(),
        completed_by: `${profile.full_name} (${profile.role})`,
        outcome: 'resolved',
        outcome_reason: reason.trim() || null,
        outcome_by: `${profile.full_name} (${profile.role})`,
        outcome_at: new Date().toISOString()
      }

      const { error } = await supabase.from('maintenance_actions').update(payload).eq('id', actionId)
      if (error) {
        alert('Failed to complete action: ' + error.message)
        setActionUpdatingId(null)
        return
      }

      if (eq?.id) {
        const { data: remainingActions } = await supabase
          .from('maintenance_actions')
          .select('id')
          .eq('equipment_id', eq.id)
          .in('status', ['pending', 'in_progress', 'delayed', 'for_disposal', 'unresolved'])

        const noneLeft = !remainingActions || remainingActions.length === 0
        if (noneLeft) {
          const finalStatus = isFE ? 'no_longer_in_service' : 'functional'
          await supabase.from('equipment').update({ current_status: finalStatus }).eq('id', eq.id)
        }

        // Only when the unit was actually retired: a fire extinguisher with
        // another open action stays in service, so no unit leaves the
        // storeroom and no replacement is needed yet.
        if (isFE && noneLeft) {
          // Decrement stock. Read the current count from the database rather
          // than the copy on screen, which can be out of date if stock was
          // changed elsewhere since the page loaded.
          const { data: currentStock } = await supabase
            .from('equipment_stock')
            .select('quantity_available')
            .eq('equipment_type', 'fire_extinguisher')
            .maybeSingle()
          const stockEmpty = !currentStock || currentStock.quantity_available <= 0
          if (!stockEmpty) {
            const { error: stockError } = await supabase
              .from('equipment_stock')
              .update({
                quantity_available: currentStock.quantity_available - 1,
                updated_at: new Date().toISOString(),
                updated_by: `${profile.full_name} (${profile.role})`
              })
              .eq('equipment_type', 'fire_extinguisher')
            if (stockError) console.error('Error deducting stock:', stockError)
          }
          getStock()

          setReplacementPrompt({
            oldCode: eq.equipment_code,
            equipment_type: eq.equipment_type,
            building_id: eq.building_id,
            exact_location: eq.exact_location,
            stockEmpty
          })
        }
      }
    } else {
      // UNRESOLVED: equipment stays defective, problem stays visible in Priority Actions
      const payload = {
        status: 'unresolved',
        outcome: 'unresolved',
        outcome_reason: reason.trim(),
        outcome_by: `${profile.full_name} (${profile.role})`,
        outcome_at: new Date().toISOString()
      }

      const { error } = await supabase.from('maintenance_actions').update(payload).eq('id', actionId)
      if (error) {
        alert('Failed to record unresolved outcome: ' + error.message)
        setActionUpdatingId(null)
        return
      }
    }

    setOutcomeModal(null)
    setOutcomeReason('')
    setOutcomeChoice('resolved')
    getMaintenanceActions()
    getCompletedActions()
    getAllActions()
    getEquipment()
    setActionUpdatingId(null)
  }

  // Reassess an unresolved action: sends it back to pending for a fresh Job
  // Order. The old outcome and technician are cleared too — before, the card
  // kept showing "Outcome: UNRESOLVED" and "Assigned to" while it was pending.
  async function reassessAction(actionId) {
    if (!window.confirm('Reassess this action?\n\nThis sends it back to Pending so a new Job Order Request can be made (for example with a different technician).')) return

    setActionUpdatingId(actionId)
    const { error } = await supabase
      .from('maintenance_actions')
      .update({
        status: 'pending',
        repair_path: null,
        budget_status: 'not_applicable',
        repair_status: null,
        repair_note: null,
        repaired_at: null,
        assigned_technician_id: null,
        decided_by: null,
        decided_at: null,
        job_order_remarks: null,
        outcome: null,
        outcome_reason: null,
        outcome_by: null,
        outcome_at: null
      })
      .eq('id', actionId)

    if (error) {
      alert('Failed to reassess action: ' + error.message)
    } else {
      getMaintenanceActions()
      getAllActions()
    }
    setActionUpdatingId(null)
  }

  // Submit the Job Order Request: records the request, assigns the technician
  // and starts the work in one step. The technician sees it in their mobile
  // dashboard; GSO verifies and records the outcome after they mark it repaired.
  async function handleConfirmStartWork() {
    if (!techAssignModal) return
    const { actionId, equipmentCode, isReassign } = techAssignModal

    if (!selectedTechnicianId) {
      alert('Please select a technician for this Job Order.')
      return
    }

    // Reassigning to the technician who already has it would only wipe their
    // progress ("Working on it") and note, so there is nothing to save.
    if (isReassign && selectedTechnicianId === techAssignModal.currentTechnicianId) {
      setTechAssignModal(null)
      setSelectedTechnicianId('')
      return
    }

    const tech = technicians.find((t) => t.id === selectedTechnicianId)
    if (!isReassign) {
      const message =
        `Submit Job Order Request for ${equipmentCode}?\n\n` +
        `Assigned technician: ${tech?.full_name}${tech?.is_available ? '' : ' (currently marked Unavailable)'}.` +
        `${tech?.profile_id ? '' : '\n\nNote: this technician has no mobile app account, so they cannot update the repair status themselves.'}` +
        `\n\nThe action will be marked In Progress.`
      if (!window.confirm(message)) return
    }

    setActionUpdatingId(actionId)
    const payload = isReassign
      ? { assigned_technician_id: selectedTechnicianId, repair_status: 'assigned', repair_note: null, repaired_at: null }
      : {
          repair_path: 'job_order',
          decided_by: `${profile.full_name} (${profile.role})`,
          decided_at: new Date().toISOString(),
          job_order_remarks: jobOrderRemarks.trim() || null,
          status: 'in_progress',
          assigned_technician_id: selectedTechnicianId,
          repair_status: 'assigned'
        }

    const { error } = await supabase.from('maintenance_actions').update(payload).eq('id', actionId)
    if (error) {
      // Keep the form open so the remarks and technician choice aren't lost.
      alert('Failed to submit Job Order: ' + error.message)
      setActionUpdatingId(null)
      return
    }
    // Refreshed here too, not only by the live updates, so the technician
    // cards' numbers and the "Assign job order" list change right away.
    getMaintenanceActions()
    getAllActions()

    setTechAssignModal(null)
    setSelectedTechnicianId('')
    setJobOrderRemarks('')
    setActionUpdatingId(null)
  }

  // Takes 1 unit of a type out of the storeroom stock, reading the current
  // count from the database (the copy on screen can be out of date).
  // Does nothing when the storeroom has none.
  async function takeOneFromStock(type) {
    const { data: current } = await supabase
      .from('equipment_stock')
      .select('quantity_available')
      .eq('equipment_type', type)
      .maybeSingle()
    if (!current || current.quantity_available <= 0) return false
    const { error } = await supabase
      .from('equipment_stock')
      .update({
        quantity_available: current.quantity_available - 1,
        updated_at: new Date().toISOString(),
        updated_by: `${profile.full_name} (${profile.role})`
      })
      .eq('equipment_type', type)
    if (error) {
      console.error('Error taking a unit from stock:', error)
      return false
    }
    return true
  }

  async function handleSaveStock(type) {
    // Whole units only: "2.5" or "3abc" used to be saved quietly as 2 or 3.
    const raw = String(stockEdits[type] ?? '').trim()
    if (!/^\d+$/.test(raw)) {
      alert('Stock quantity must be a whole number (0 or more).')
      return
    }
    const qty = parseInt(raw, 10)

    setStockSaving(true)
    const { error } = await supabase
      .from('equipment_stock')
      .upsert({
        equipment_type: type,
        quantity_available: qty,
        updated_at: new Date().toISOString(),
        updated_by: `${profile.full_name} (${profile.role})`
      })

    if (error) {
      if (error.message?.includes('schema cache') || error.message?.includes('does not exist')) {
        alert('Database table "equipment_stock" has not been created yet in Supabase.\n\nPlease run the SQL migration (001_outcome_stock_technicians.sql) in your Supabase SQL Editor.')
      } else {
        alert('Failed to update stock: ' + error.message)
      }
    } else {
      setStockMessage(`Stock for ${typeLabel(type)} updated.`)
      setTimeout(() => setStockMessage(null), 3000)
      getStock()
    }
    setStockSaving(false)
  }

  // Technician management handlers
  async function handleTechnicianSubmit(e) {
    e.preventDefault()
    setTechnicianError(null)

    if (!technicianForm.full_name.trim()) {
      setTechnicianError('Technician name is required.')
      return
    }
    const accountProblem = checkAccountFields(technicianForm.username, technicianForm.password)
    if (accountProblem) {
      setTechnicianError(accountProblem)
      return
    }

    // Creates the technician AND their mobile app login in one step.
    setTechnicianSubmitting(true)
    const { data, error } = await supabase.rpc('create_staff_account', {
      p_role: 'technician',
      p_full_name: technicianForm.full_name.trim(),
      p_username: technicianForm.username.trim(),
      p_password: technicianForm.password,
      p_contact: technicianForm.contact_info.trim() || null
    })

    if (error) {
      setTechnicianError(accountErrorMessage(error))
    } else {
      setAccountNotice(
        `Technician account created. ${technicianForm.full_name.trim()} can now sign in to the mobile app with username "${data?.username}".`
      )
      setTechnicianForm({ full_name: '', contact_info: '', username: '', password: '' })
      setShowTechnicianForm(false)
      getTechnicians()
      getStaffAccounts()
    }
    setTechnicianSubmitting(false)
  }

  // Gives an existing technician (added before accounts existed) a login.
  async function handleCreateTechnicianLogin(technician) {
    setTechLoginError(null)
    const problem = checkAccountFields(techLoginForm.username, techLoginForm.password)
    if (problem) {
      setTechLoginError(problem)
      return
    }
    setTechLoginSaving(true)
    const { data, error } = await supabase.rpc('create_staff_account', {
      p_role: 'technician',
      p_full_name: technician.full_name,
      p_username: techLoginForm.username.trim(),
      p_password: techLoginForm.password,
      p_contact: null,
      p_technician_id: technician.id
    })
    setTechLoginSaving(false)
    if (error) {
      setTechLoginError(accountErrorMessage(error))
      return
    }
    setAccountNotice(
      `App account created. ${technician.full_name} can now sign in to the mobile app with username "${data?.username}".`
    )
    setTechLoginFor(null)
    setTechLoginForm({ username: '', password: '' })
    getTechnicians()
    getStaffAccounts()
  }

  async function getStaffAccounts() {
    const { data, error } = await supabase.rpc('list_staff_accounts')
    // Before migration 005 this function doesn't exist; usernames just don't show.
    if (!error) setStaffAccounts(data || [])
  }

  // Availability is set by the technician in the mobile app (migration 009).
  // Only a technician with no app account can't do that, so for them the
  // admin still sets it in Edit.
  function startEditTechnician(t) {
    setEditingTechnicianId(t.id)
    setEditTechnicianError(null)
    setEditTechnicianForm({
      full_name: t.full_name || '',
      contact_info: t.contact_info || '',
      is_available: t.is_available,
      has_account: !!t.profile_id
    })
  }

  function cancelEditTechnician() {
    setEditingTechnicianId(null)
    setEditTechnicianForm({})
    setEditTechnicianError(null)
  }

  async function saveEditTechnician(id) {
    if (!editTechnicianForm.full_name.trim()) {
      setEditTechnicianError('Technician name is required.')
      return
    }

    setEditTechnicianSaving(true)
    const changes = {
      full_name: editTechnicianForm.full_name.trim(),
      contact_info: editTechnicianForm.contact_info.trim() || null
    }
    if (!editTechnicianForm.has_account) changes.is_available = editTechnicianForm.is_available
    const { error } = await supabase.from('technicians').update(changes).eq('id', id)

    if (error) {
      setEditTechnicianError(error.message)
    } else {
      setEditingTechnicianId(null)
      getTechnicians()
    }
    setEditTechnicianSaving(false)
  }

  async function deleteTechnician(id, name) {
    // Deleting would leave these jobs "In Progress" with nobody assigned.
    const activeJobs = maintenanceActions.filter(
      (a) => a.assigned_technician_id === id && a.status === 'in_progress'
    )
    if (activeJobs.length > 0) {
      alert(
        `${name} still has ${activeJobs.length} job${activeJobs.length === 1 ? '' : 's'} in progress ` +
          `(${activeJobs.map((a) => a.equipment?.equipment_code).join(', ')}).\n\n` +
          'Reassign those jobs to another technician first, then delete.'
      )
      return
    }

    if (!window.confirm(`Delete technician "${name}"? Any past actions assigned to this technician will retain their record.`)) return

    const { error } = await supabase.from('technicians').delete().eq('id', id)
    if (error) {
      alert('Failed to delete technician: ' + error.message)
    } else {
      getTechnicians()
    }
  }

  // Called when GSO confirms the suggested replacement. Pre-fills the type
  // and location from the retired unit, generates a new code the normal
  // way, and defaults to a 2-year expiration from today — the standard
  // shelf life for the ABC dry chemical units NBSC stocks. All of it stays
  // editable afterward through the normal Edit form if a specific unit differs.
  async function handleAddReplacement() {
    if (!replacementPrompt) return

    const newCode = await generateEquipmentCode(supabase, replacementPrompt.equipment_type)
    // Local calendar dates. toISOString() is UTC, which in the Philippines
    // gives yesterday's date before 8 AM.
    const ymd = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const today = new Date()
    const installDate = ymd(today)
    const expiry = new Date(today)
    expiry.setFullYear(expiry.getFullYear() + 2)
    const expiryDate = ymd(expiry)

    const { error } = await supabase.from('equipment').insert([
      {
        equipment_code: newCode,
        equipment_type: replacementPrompt.equipment_type,
        building_id: replacementPrompt.building_id,
        exact_location: replacementPrompt.exact_location,
        qr_code: newCode,
        installation_date: installDate,
        expiration_date: expiryDate,
        current_status: 'functional',
        description: null
      }
    ])

    if (error) {
      console.error('Error adding replacement equipment:', error)
      alert('Failed to add replacement: ' + error.message)
    } else {
      getEquipment()
      setReplacementPrompt(null)
      setActiveTab('equipment')
    }
  }

  // Every equipment type in use: the 5 built-in ones plus any added through
  // "Others" (found in Stock or Equipment). Feeds the type dropdowns, the
  // Stock page and the Summary.
  const allTypes = [
    ...new Set([
      ...EQUIPMENT_TYPES,
      ...stock.map((s) => s.equipment_type),
      ...equipment.map((e) => e.equipment_type)
    ])
  ].filter(Boolean)

  const sortedActions = [...maintenanceActions].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] || 5
    const pb = PRIORITY_ORDER[b.priority] || 5
    if (pa !== pb) return pa - pb
    return new Date(a.reported_date) - new Date(b.reported_date)
  })

  // Group inspections by equipment so each card can show its own history
  const inspectionsByEquipment = inspections.reduce((acc, insp) => {
    if (!acc[insp.equipment_id]) acc[insp.equipment_id] = []
    acc[insp.equipment_id].push(insp)
    return acc
  }, {})

  // Each unit's most recent fixed defect (completedActions is newest first).
  // Feeds the decision-support recommendation on Equipment cards.
  const lastResolvedByEquipment = {}
  completedActions.forEach((a) => {
    const id = a.equipment?.id
    if (id && !lastResolvedByEquipment[id]) lastResolvedByEquipment[id] = a
  })

  // Active deployed equipment (excluding decommissioned/retired units)
  const totalEquipment = equipment.filter((e) => e.current_status !== 'no_longer_in_service').length
  const activeCount = equipment.filter((e) => e.current_status === 'functional').length
  const needsActionCount = equipment.filter(
    (e) => e.current_status !== 'functional' && e.current_status !== 'no_longer_in_service'
  ).length
  const pendingActionsCount = sortedActions.length

  // Priority Actions counts by stage
  const pendingCount = sortedActions.filter((a) => a.status === 'pending').length
  // Used by the In Progress / Unresolved filter buttons, which are hidden
  // for now (see the commented-out buttons in Priority Actions).
  // const inProgressCount = sortedActions.filter((a) => a.status === 'in_progress').length
  // const unresolvedCount = sortedActions.filter((a) => a.status === 'unresolved').length

  const displayedActions = sortedActions.filter((a) => {
    if (priorityFilter === 'pending') return a.status === 'pending'
    if (priorityFilter === 'in_progress') return a.status === 'in_progress'
    if (priorityFilter === 'unresolved') return a.status === 'unresolved'
    // "All" lists every active card (read-only) under the Purchase Request
    // summary, so the count on the chip matches what is shown.
    return true
  })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // A bare 'YYYY-MM-DD' is parsed by JavaScript as UTC midnight, which in
  // timezones behind UTC lands on the previous day. Build it from its parts
  // so the expiry stays on the calendar day it was entered as (same as the
  // mobile app).
  function daysUntil(dateString) {
    if (!dateString) return null
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString)
    const target = match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      : new Date(dateString)
    target.setHours(0, 0, 0, 0)
    return Math.round((target - today) / (1000 * 60 * 60 * 24))
  }

  // Retired units no longer need an expiry warning.
  const expiringEquipment = equipment
    .filter((item) => item.current_status !== 'no_longer_in_service')
    .map((item) => ({ ...item, daysLeft: daysUntil(item.expiration_date) }))
    .filter((item) => item.daysLeft !== null && item.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)

  // Defects still waiting for a Job Order (no technician yet) — offered by
  // "Assign job order" on a technician's card. And what needs a Purchase
  // Request (replacement needed, not enough stock on hand).
  const jobOrderActions = sortedActions.filter((a) => a.status === 'pending')
  const purchaseRequestItems = findPurchaseRequestItems({
    actions: sortedActions,
    expiring: expiringEquipment,
    stock
  })

  // Unavailable dates still current or coming up, with who sent them.
  const todayPh = manilaDay(new Date())
  const upcomingLeaves = unavailability
    .filter((l) => l.end_date >= todayPh)
    .map((l) => {
      const acc = staffAccounts.find((a) => a.id === l.profile_id)
      return { ...l, name: acc ? acc.full_name : 'A staff member', role: acc ? acc.role : 'inspector' }
    })
  // Each person's latest Available / Unavailable switch, with who it is.
  // Only the latest counts: switching off and on again shows one alert
  // with where they ended up.
  const latestAvailability = []
  availabilityChanges.forEach((c) => {
    if (latestAvailability.some((x) => x.profile_id === c.profile_id)) return
    const acc = staffAccounts.find((a) => a.id === c.profile_id)
    latestAvailability.push({ ...c, name: acc ? acc.full_name : 'A staff member', role: acc ? acc.role : 'inspector' })
  })

  // A person's current / upcoming unavailable dates, earliest first.
  const leavesFor = (profileId) => (profileId ? upcomingLeaves.filter((l) => l.profile_id === profileId) : [])

  // Notifications shown in the header bell
  const gsoNotifications = buildGsoNotifications({
    actions: sortedActions,
    expiring: expiringEquipment,
    completed: completedActions,
    purchaseRequests: purchaseRequestItems,
    leaves: upcomingLeaves,
    availability: latestAvailability
  })

  // Shared by the Reports page and the Equipment page's Print Report.
  const reportCtx = {
    typeLabel,
    statusLabel: (s) => STATUS_LABELS[s] || s,
    formatTimestamp,
    daysUntil,
    inspectionsByEquipment
  }

  function printReport(report) {
    if (!report) return
    setReportPrint({ ...report, generatedAt: new Date() })
  }

  // Dashboard graphs
  const retiredCount = equipment.length - totalEquipment
  // Installed units of one type, counted from the equipment records (the
  // Stock page). "Inspected this month" = units inspected since the 1st of
  // this month (Philippine time), with the result of their latest one.
  const monthStart = `${manilaDay(new Date()).slice(0, 7)}-01`
  function installedStats(type) {
    const ofType = equipment.filter((e) => e.equipment_type === type)
    const items = ofType.filter((e) => e.current_status !== 'no_longer_in_service')
    const ok = items.filter((e) => e.current_status === 'functional').length
    let inspected = 0
    let inspectedOk = 0
    items.forEach((e) => {
      const latest = (inspectionsByEquipment[e.id] || [])[0]
      if (latest && manilaDay(latest.inspection_date) >= monthStart) {
        inspected += 1
        if (latest.condition_status === 'defective') return
        inspectedOk += 1
      }
    })
    return {
      total: items.length,
      ok,
      bad: items.length - ok,
      retired: ofType.length - items.length,
      inspected,
      inspectedOk,
      inspectedBad: inspected - inspectedOk
    }
  }

  // Per type: in service (functional / needs attention), no longer in
  // service, and new units waiting in the storeroom (Stock page).
  const typeChartRows = allTypes.map((type) => {
    const ofType = equipment.filter((e) => e.equipment_type === type)
    const items = ofType.filter((e) => e.current_status !== 'no_longer_in_service')
    const ok = items.filter((e) => e.current_status === 'functional').length
    return {
      type,
      label: typeLabel(type),
      ok,
      bad: items.length - ok,
      retired: ofType.length - items.length,
      storeroom: stock.find((s) => s.equipment_type === type)?.quantity_available || 0
    }
  })

  // Technician cards: counted the same way as the technician's own app
  // (get_my_stats in migration 009).
  function technicianCounts(techId) {
    const mine = allActions.filter((a) => a.assigned_technician_id === techId)
    const open = mine.filter((a) => a.status === 'in_progress')
    return {
      assigned: open.filter((a) => (a.repair_status || 'assigned') !== 'repaired').length,
      working: open.filter((a) => a.repair_status === 'working').length,
      completed: mine.filter((a) => a.status === 'completed').length
    }
  }

  // System Summary preview on the Reports page
  const weekAgo = new Date().getTime() - 7 * 24 * 60 * 60 * 1000
  const summaryRows = [
    ['Equipment in service', totalEquipment],
    ['Functional', activeCount],
    ['Needs attention', needsActionCount],
    ['No Longer in Service', retiredCount],
    ['Priority Actions (open)', sortedActions.length],
    ['Needs Job Order Request', pendingCount],
    ['Needs Purchase Request', purchaseRequestItems.length],
    ['Expiring within 30 days / expired', expiringEquipment.length],
    ['Inspections in the last 7 days', inspections.filter((i) => new Date(i.inspection_date).getTime() >= weekAgo).length]
  ]

  // Opens the Job Order Request form for a reported defect. From Priority
  // Actions no technician is picked yet; from a technician's card
  // ("Assign job order") that technician is already chosen.
  function openJobOrderRequest(action, technicianId) {
    setSelectedTechnicianId(technicianId || '')
    setJobOrderRemarks('')
    setTechAssignModal({
      actionId: action.id,
      isFireExtinguisher: action.equipment?.equipment_type === 'fire_extinguisher',
      equipmentCode: action.equipment?.equipment_code,
      equipmentType: action.equipment?.equipment_type,
      location: `${action.equipment?.buildings?.building_name ?? 'N/A'} — ${action.equipment?.exact_location ?? ''}`,
      finding: action.description,
      actionType: action.action_type,
      priority: action.priority,
      reportedDate: action.reported_date
    })
  }

  // Opens the Reports page on one report (e.g. 'expiry' for Expiring /
  // Expired — the dashboard no longer has its own Expiration Alerts list).
  function openReport(key) {
    setReportStart({ key, n: reportStart.n + 1 })
    setActiveTab('reports')
    window.scrollTo({ top: 0 })
  }

  // "Needs a purchase request" (inspection / repair history): the Purchase
  // Request summary on the dashboard.
  function openPurchaseSummary() {
    setActiveTab('dashboard')
    setPriorityFilter('all')
    scrollToId('priority-actions-section')
  }

  function goTab(tab) {
    // The sidebar's Reports always starts on the first report.
    if (tab === 'reports') setReportStart({ key: 'inventory', n: reportStart.n + 1 })
    setActiveTab(tab)
    if (tab === 'technicians') getTechnicians()
    window.scrollTo({ top: 0 })
  }

  function scrollToId(id) {
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  // Opens one Priority Action in the filter where its action buttons are,
  // and scrolls to its card.
  function openActionInFilter(action) {
    const filter =
      action.status === 'pending' ? 'pending'
        : action.status === 'in_progress' ? 'in_progress'
        : action.status === 'unresolved' ? 'unresolved'
        : 'all'
    setActiveTab('dashboard')
    setPriorityFilter(filter)
    scrollToId(`action-card-${action.id}`)
  }

  function handleNotificationNavigate(n) {
    if (n.target === 'summary') {
      setShowSummary(true)
      return
    }
    // Unavailable dates: the person's page (their card has the calendar).
    if (n.target === 'leave') {
      goTab(n.role === 'technician' ? 'technicians' : 'inspectors')
      return
    }
    setActiveTab('dashboard')
    if (n.target === 'expiry') {
      openReport('expiry')
      return
    }
    if (n.target === 'purchase') {
      setPriorityFilter('all')
      scrollToId('priority-actions-section')
      return
    }
    const action = sortedActions.find((a) => a.id === n.actionId)
    if (action) openActionInFilter(action)
    else scrollToId('priority-actions-section')
  }

  const filteredEquipment = equipment.filter((item) => {
    const term = searchTerm.trim().toLowerCase()
    const matchesSearch =
      term === '' ||
      item.equipment_code?.toLowerCase().includes(term) ||
      item.exact_location?.toLowerCase().includes(term) ||
      item.buildings?.building_name?.toLowerCase().includes(term)

    const matchesType = !filterType || item.equipment_type === filterType
    const matchesStatus =
      !filterStatus ||
      (filterStatus === '__needs_attention__'
        ? item.current_status !== 'functional' && item.current_status !== 'no_longer_in_service'
        : item.current_status === filterStatus)
    const matchesBuilding = !filterBuilding || item.building_id === filterBuilding

    return matchesSearch && matchesType && matchesStatus && matchesBuilding
  })

  // A retired unit's QR code is a unique identifier that must never go on a
  // new sticker, so retired units are left out of label printing.
  const printableEquipment = filteredEquipment.filter(
    (item) => item.current_status !== 'no_longer_in_service'
  )

  const locationsForSelectedBuilding = buildingLocations.filter(
    (loc) => loc.building_id === form.building_id
  )
  const floorsForSelectedBuilding = [...new Set(locationsForSelectedBuilding.map((l) => l.floor_label))]
  const locationsForSelectedFloor = locationsForSelectedBuilding.filter(
    (loc) => loc.floor_label === formFloor
  )
  const selectedBuildingHasLocations = locationsForSelectedBuilding.length > 0

  // Clicking a stat card into Equipment should show exactly what the card
  // promised — not everything with the filters wiped, and not last time's
  // leftover filters. This resets all filters first, then applies the one
  // that matches the card. '__needs_attention__' is a sentinel — anything
  // other than functional counts as needing attention, which a single
  // dropdown value can't express directly, so filteredEquipment below
  // special-cases it.
  function jumpToEquipment(statusFilter) {
    setSearchTerm('')
    setFilterType('')
    setFilterBuilding('')
    setFilterStatus(statusFilter)
    setActiveTab('equipment')
  }

  return (
    <div>
      <header className="app-header app-header-compact">
        <div className="title-block">
          <img className="brand-mark" src={logoMarkDarkBg} alt="FireScan logo" />
          <div className="brand-lockup">
            <h1 className="brand-name">Fire<span>Scan</span></h1>
            <div className="brand-tagline">NBSC Fire Safety Equipment Monitoring and Inspection</div>
          </div>
        </div>

        <div className="header-search">
          <span className="header-search-icon"></span>
          <input
            placeholder="Search equipment code, location, building..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setActiveTab('equipment')
                setTimeout(() => {
                  document.getElementById('equipment-inventory-section')?.scrollIntoView({ behavior: 'smooth' })
                }, 0)
              }
            }}
          />
          {searchTerm && (
            <button className="header-search-clear" onClick={() => setSearchTerm('')}>
              ✕
            </button>
          )}
        </div>

        <div className="user-chip">
          <span className="status-chip" style={{ marginRight: '4px' }}>
            <span className={`status-dot ${needsActionCount > 0 ? 'alert' : ''}`}></span>
            {needsActionCount > 0 ? `${needsActionCount} need attention` : 'All operational'}
          </span>
          <button
            className="logout-btn"
            style={{ marginRight: '6px' }}
            onClick={() => setShowSummary(true)}
          >
            Summary
          </button>
          <NotificationBell
            accountId={profile.id}
            notifications={gsoNotifications}
            onNavigate={handleNotificationNavigate}
            ready={initialLoaded}
          />
        </div>
      </header>

      <div className="app-layout">
        <aside className="app-sidebar">
          {SIDEBAR_GROUPS.map((group) => (
            <div key={group.title} className="side-group">
              <div className="side-group-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  key={item.tab}
                  className={`side-item ${activeTab === item.tab ? 'active' : ''}`}
                  onClick={() => goTab(item.tab)}
                >
                  <NavIcon name={item.tab} />
                  <span className="side-text">{item.label}</span>
                  {item.tab === 'dashboard' && expiringEquipment.length > 0 && (
                    <span
                      className="side-badge"
                      title={`${expiringEquipment.length} expiring within 30 days or expired`}
                    >
                      {expiringEquipment.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
          <div className="side-user">
            <strong>{profile.full_name}</strong>
            <span style={{ textTransform: 'capitalize' }}>{profile.role}</span>
            <button className="side-logout" onClick={onLogout}>
              <svg className="side-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="M16 17l5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              <span className="side-text">Log out</span>
            </button>
          </div>
        </aside>

        <main className="main-content">
          <div className="page-wrap">
        {(activeTab === 'dashboard' || activeTab === 'priority') && (
        <div>
            <div className="stat-grid">
              <button className="stat-card stat-card-clickable" onClick={() => jumpToEquipment('')}>
                <div className="stat-icon blue">📦</div>
                <div>
                  <div className="stat-value">{totalEquipment}</div>
                  <div className="stat-label">Total Equipment</div>
                </div>
              </button>
              <button className="stat-card stat-card-clickable" onClick={() => jumpToEquipment('functional')}>
                <div className="stat-icon green">✓</div>
                <div>
                  <div className="stat-value">{activeCount}</div>
                  <div className="stat-label">Functional</div>
                </div>
              </button>
              <button className="stat-card stat-card-clickable" onClick={() => jumpToEquipment('__needs_attention__')}>
                <div className="stat-icon red">⚠</div>
                <div>
                  <div className="stat-value">{needsActionCount}</div>
                  <div className="stat-label">Needs Attention</div>
                </div>
              </button>
              <button
                className="stat-card stat-card-clickable"
                onClick={() => {
                  setActiveTab('dashboard')
                  setPriorityFilter('all')
                  setTimeout(() => {
                    document.getElementById('priority-actions-section')?.scrollIntoView({ behavior: 'smooth' })
                  }, 50)
                }}
              >
                <div className="stat-icon amber">🛠</div>
                <div>
                  <div className="stat-value">{pendingActionsCount}</div>
                  <div className="stat-label">Priority Actions</div>
                </div>
              </button>
            </div>

            <div className="chart-grid">
              {/* Pie chart hidden for now (adviser's request): "Equipment by
                  type" below has the same totals, per type and overall.
              <StatusDonut
                functional={activeCount}
                needsAttention={needsActionCount}
                retired={retiredCount}
              />
              */}
              <TypeBars rows={typeChartRows} />
              <InspectionWeeks inspections={inspections} />
            </div>

        <div id="priority-actions-section" className="section-heading" style={{ scrollMarginTop: '80px' }}>
          <h2>Priority Actions</h2>
          {sortedActions.length > 0 && (
            <span className="count-pill">{sortedActions.length} active</span>
          )}
        </div>

        {/* Live stage filter chips */}
        <div className="filter-chip-group">
          <button
            className={`filter-chip ${priorityFilter === 'all' ? 'active' : ''}`}
            onClick={() => setPriorityFilter('all')}
          >
            All <span className="chip-count">{sortedActions.length}</span>
          </button>

          {/* Hidden for now (adviser's request). Kept in the code so they can
              be turned back on: remove these comment markers.
          <button
            className={`filter-chip ${priorityFilter === 'in_progress' ? 'active' : ''}`}
            onClick={() => setPriorityFilter('in_progress')}
          >
            🔧 In Progress <span className="chip-count">{inProgressCount}</span>
          </button>
          <button
            className={`filter-chip ${priorityFilter === 'unresolved' ? 'active' : ''}`}
            onClick={() => setPriorityFilter('unresolved')}
          >
            ⚠️ Unresolved <span className="chip-count">{unresolvedCount}</span>
          </button>
          */}
        </div>

        {/* "All" is an overview: the Purchase Request summary, then every
            active card read-only. The action buttons live in the stage filters
            (Needs Job Order / In Progress / Unresolved), opened from
            notifications. */}
        {priorityFilter === 'all' && (
          <PriorityActionsSummary
            purchaseItems={purchaseRequestItems}
            onOpenAction={openActionInFilter}
            onOpenExpiry={() => openReport('expiry')}
          />
        )}

        {displayedActions.length === 0 ? (
          priorityFilter === 'all' ? null : (
            <div className="all-clear-banner">
              {sortedActions.length === 0
                ? '✓ No pending actions. All equipment accounted for.'
                : `✓ No actions in "${priorityFilter.replace('_', ' ')}" stage.`}
            </div>
          )
        ) : (
          displayedActions.map((action) => {
            const age = daysAgo(action.reported_date)
            const isOverdue = age !== null && age >= 7
            const isFireExtinguisher = action.equipment?.equipment_type === 'fire_extinguisher'

            // GSO action: file a Job Order Request. It records the request,
            // assigns a technician and starts the work.
            const needsJobOrder = action.status === 'pending'
            // In the "All" overview the cards are read-only (no buttons).
            const readOnly = priorityFilter === 'all'
            const needsPurchase = purchaseRequestItems.some((p) => p.actionId === action.id)

            let cardStyle = isOverdue ? 'overdue' : 'warning'
            if (action.status === 'unresolved') cardStyle = 'overdue'

            const assignedTech = technicians.find((t) => t.id === action.assigned_technician_id)

            return (
              <div
                key={action.id}
                id={`action-card-${action.id}`}
                className={`action-card ${cardStyle}`}
                style={{ scrollMarginTop: '90px' }}
              >
                <div className="action-title">
                  ⚠ {action.equipment?.equipment_code} —{' '}
                  {TYPE_LABELS[action.equipment?.equipment_type] || action.equipment?.equipment_type}
                  {isOverdue && action.status === 'pending' && <span className="overdue-tag">OVERDUE</span>}
                  {action.status === 'unresolved' && <span className="overdue-tag" style={{ background: '#b91c1c' }}>UNRESOLVED</span>}
                  {needsPurchase && <span className="overdue-tag" style={{ background: '#b45309' }}>NEEDS PURCHASE REQUEST</span>}
                </div>
                <p>
                  {action.equipment?.buildings?.building_name ?? 'N/A'} — {action.equipment?.exact_location}
                </p>
                <p>{action.description} <span style={{ color: 'var(--text-muted)' }}>({ACTION_LABELS[action.action_type] || action.action_type})</span></p>
                <p>
                  Priority: <strong style={{ textTransform: 'capitalize' }}>{action.priority}</strong>{' '}
                  &nbsp;·&nbsp; Status: <strong style={{ textTransform: 'capitalize' }}>{action.status.replace('_', ' ')}</strong>
                </p>

                {(action.repair_path === 'job_order' || isFireExtinguisher) && (
                  <p style={{ color: 'var(--text-muted)' }}>
                    {action.repair_path === 'job_order' && (
                      <>Job Order filed{action.job_order_remarks ? <> — "{action.job_order_remarks}"</> : null}</>
                    )}
                    {action.repair_path === 'job_order' && isFireExtinguisher && ' · '}
                    {isFireExtinguisher && (
                      <span style={{ fontStyle: 'italic' }}>
                        this unit retires once complete — the replacement gets its own new entry
                      </span>
                    )}
                  </p>
                )}

                <div className="meta">
                  Reported {formatTimestamp(action.reported_date)}
                  {assignedTech && (
                    <>
                      <br />
                      Assigned to: <strong>{assignedTech.full_name}</strong> {assignedTech.contact_info ? `(${assignedTech.contact_info})` : ''}
                    </>
                  )}
                  {action.decided_by && (
                    <>
                      <br />
                      Decided by <strong>{action.decided_by}</strong> · {formatTimestamp(action.decided_at)}
                    </>
                  )}
                  {action.outcome && (
                    <>
                      <br />
                      Outcome: <strong style={{ color: action.outcome === 'resolved' ? 'var(--green)' : 'var(--red)' }}>{action.outcome.toUpperCase()}</strong>
                      {action.outcome_reason && <> — "{action.outcome_reason}"</>}
                      {action.outcome_by && <> · Reported by <strong>{action.outcome_by}</strong> {relativeTime(action.outcome_at)}</>}
                    </>
                  )}
                  {action.completed_by && !action.outcome && (
                    <>
                      <br />
                      Completed by <strong>{action.completed_by}</strong>
                    </>
                  )}
                </div>

                {(() => {
                  const history = inspectionsByEquipment[action.equipment?.id] || []
                  const isExpanded = expandedActionId === action.id
                  if (readOnly) return null
                  return (
                    <>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ marginTop: '8px' }}
                        onClick={() => setExpandedActionId(isExpanded ? null : action.id)}
                      >
                        {isExpanded ? 'Hide history' : `Show history (${history.length})`}
                      </button>
                      {isExpanded && (
                        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                          {history.length === 0 ? (
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                              No inspection history recorded for this unit yet.
                            </p>
                          ) : (
                            history.slice(0, 3).map((insp) => {
                              const failed = insp.condition_status === 'defective'
                              return (
                                <div
                                  key={insp.id}
                                  style={{
                                    borderLeft: `3px solid ${failed ? 'var(--red)' : 'var(--green)'}`,
                                    paddingLeft: '10px',
                                    marginBottom: '8px'
                                  }}
                                >
                                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                                    {failed ? '⚠ Defective' : '✓ Functional'}
                                  </span>
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                                    {relativeTime(insp.inspection_date)}
                                  </span>
                                  {insp.findings && (
                                    <p style={{ fontSize: '0.82rem', margin: '2px 0 0 0' }}>{insp.findings}</p>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </>
                  )
                })()}

                {/* Job Orders are filed from the technician's card now
                    (Technicians → "Assign job order"), not from here. */}
                {/* What this defect needs next. A unit that needs a new unit
                    with no stock to cover it can't go to a technician yet:
                    the Purchase Request comes first. */}
                {needsJobOrder && (
                  <p style={{ fontSize: '0.85rem', fontWeight: 600, color: needsPurchase ? 'var(--red)' : 'var(--amber)', margin: '10px 0 0 0' }}>
                    {needsPurchase
                      ? `Needs a Purchase Request first — there is no ${typeLabel(action.equipment?.equipment_type)} in stock to replace this unit. Coordinate with the Supply Office; assign a technician once the new unit arrives.`
                      : needsReplacementUnit(action)
                      ? 'Needs a Job Order Request — a technician will install a new unit from stock. Assign it from Technicians → "Assign job order".'
                      : 'Needs a Job Order Request — assign a technician to repair it from Technicians → "Assign job order".'}
                  </p>
                )}

                {/* Stage: In progress — close with outcome tracking or reassign technician */}
                {action.status === 'in_progress' && (
                  <div style={{ marginTop: '10px' }}>
                    <p style={{ fontSize: '0.85rem', color: action.repair_status === 'repaired' ? 'var(--green)' : 'var(--blue)', fontWeight: 600, margin: '0 0 8px 0' }}>
                      {action.repair_status === 'repaired'
                        ? `✓ Technician marked this as repaired${action.repaired_at ? ' ' + relativeTime(action.repaired_at) : ''}. Verify the unit, then record the outcome.`
                        : action.repair_status === 'working'
                        ? '🔧 Technician is working on it.'
                        : 'Work is in progress. Waiting for the technician to start.'}
                    </p>
                    {action.repair_note && (
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 8px 0' }}>
                        Technician note: <em>"{action.repair_note}"</em>
                      </p>
                    )}
                    {!readOnly && (
                    <div className="action-buttons">
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setOutcomeChoice('resolved')
                          setOutcomeReason('')
                          setOutcomeModal(action)
                        }}
                        disabled={actionUpdatingId === action.id}
                      >
                        Record Outcome / Close Work
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setSelectedTechnicianId(action.assigned_technician_id || '')
                          setTechAssignModal({
                            actionId: action.id,
                            isFireExtinguisher,
                            equipmentCode: action.equipment?.equipment_code,
                            currentTechnicianId: action.assigned_technician_id || '',
                            isReassign: true
                          })
                        }}
                        disabled={actionUpdatingId === action.id}
                      >
                        Reassign Technician
                      </button>
                    </div>
                    )}
                  </div>
                )}

                {/* Stage: Unresolved — failed repair or incomplete */}
                {action.status === 'unresolved' && (
                  <div style={{ marginTop: '10px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: '8px', padding: '10px 14px' }}>
                    <p style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--red)', margin: 0 }}>
                      Work marked Unresolved
                    </p>
                    <p style={{ fontSize: '0.85rem', margin: '4px 0 8px 0' }}>
                      Reason: <em>"{action.outcome_reason || 'No reason provided'}"</em>
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: readOnly ? 0 : '0 0 10px 0' }}>
                      The equipment remains in defective status. You can reassess to try a different repair route.
                    </p>
                    {!readOnly && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => reassessAction(action.id)}
                        disabled={actionUpdatingId === action.id}
                      >
                        Reassess Action
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}

        </div>
        )}

        {activeTab === 'buildings' && (
        <div>
        <div className="section-heading" id="buildings-section">
          <h2>Buildings</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className="count-pill neutral">
              {buildings.length} building{buildings.length === 1 ? '' : 's'}
            </span>
            <button className="btn btn-primary btn-sm" onClick={() => setShowBuildingForm((v) => !v)}>
              {showBuildingForm ? 'Close' : '+ Add Building'}
            </button>
          </div>
        </div>

        {showBuildingForm && (
          <div className="panel">
            <form onSubmit={handleBuildingSubmit} className="form-grid">
              <div>
                <label className="field-label">Building Name</label>
                <input
                  name="building_name"
                  placeholder="e.g. SC Building"
                  value={buildingForm.building_name}
                  onChange={handleBuildingFormChange}
                />
              </div>
              <div>
                <label className="field-label">Location Description</label>
                <input
                  name="location_description"
                  placeholder="e.g. Main Campus, near the gate"
                  value={buildingForm.location_description}
                  onChange={handleBuildingFormChange}
                />
              </div>

              {buildingError && <p className="form-error">{buildingError}</p>}

              <button type="submit" className="btn btn-primary" disabled={buildingSubmitting}>
                {buildingSubmitting ? 'Saving...' : 'Add Building'}
              </button>
            </form>
          </div>
        )}

        {buildings.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>No buildings added yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Building</th>
                  <th>Location</th>
                  <th className="num">Floors</th>
                  <th className="num">Rooms</th>
                  <th className="num" title="Units in service (No Longer in Service not counted)">Equipment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {buildings.map((b) => {
                  const locs = buildingLocations.filter((l) => l.building_id === b.id)
                  const floorCount = new Set(locs.map((l) => l.floor_label)).size
                  const unitCount = equipment.filter(
                    (e) => e.building_id === b.id && e.current_status !== 'no_longer_in_service'
                  ).length
                  const open = expandedLocationsBuildingId === b.id
                  return (
                    <Fragment key={b.id}>
                      <tr>
                        <td><strong>{b.building_name}</strong></td>
                        <td>{b.location_description || '—'}</td>
                        <td className="num">{floorCount}</td>
                        <td className="num">{locs.length}</td>
                        <td className="num">{unitCount}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className={`btn btn-sm ${open ? 'btn-primary' : 'btn-secondary'}`}
                              onClick={() => setExpandedLocationsBuildingId(open ? null : b.id)}
                            >
                              {open ? 'Hide floors & rooms' : 'Floors & rooms'}
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => startEditBuilding(b)}>
                              Edit
                            </button>
                            <button
                              className="btn btn-outline-red btn-sm"
                              onClick={() => deleteBuilding(b.id, b.building_name)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>

                      {editingBuildingId === b.id && (
                        <tr className="row-detail">
                          <td colSpan={6}>
                            <div className="form-grid">
                              <div>
                                <label className="field-label">Building Name</label>
                                <input
                                  name="building_name"
                                  value={editBuildingForm.building_name}
                                  onChange={handleEditBuildingChange}
                                />
                              </div>
                              <div>
                                <label className="field-label">Location Description</label>
                                <input
                                  name="location_description"
                                  value={editBuildingForm.location_description}
                                  onChange={handleEditBuildingChange}
                                />
                              </div>

                              {editBuildingError && <p className="form-error">{editBuildingError}</p>}

                              <div className="equipment-actions">
                                <button
                                  className="btn btn-primary"
                                  onClick={() => saveEditBuilding(b.id)}
                                  disabled={editBuildingSaving}
                                >
                                  {editBuildingSaving ? 'Saving...' : 'Save'}
                                </button>
                                <button className="btn btn-secondary" onClick={cancelEditBuilding} disabled={editBuildingSaving}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                      {open && (
                        <tr className="row-detail">
                          <td colSpan={6}>
                      <div style={{ padding: '4px 2px' }}>
                        {(() => {
                          const locsForThisBuilding = buildingLocations.filter((l) => l.building_id === b.id)
                          const floorGroups = [...new Set(locsForThisBuilding.map((l) => l.floor_label))]

                          return (
                            <>
                              {floorGroups.length === 0 ? (
                                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                                  No floors/rooms added yet for this building.
                                </p>
                              ) : (
                                floorGroups.map((floor) => (
                                  <div key={floor} style={{ marginBottom: '12px' }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '6px' }}>
                                      {floor}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                      {locsForThisBuilding
                                        .filter((l) => l.floor_label === floor)
                                        .map((l) => (
                                          <span
                                            key={l.id}
                                            style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '6px',
                                              background: 'var(--gray-bg)',
                                              border: '1px solid var(--border)',
                                              borderRadius: '999px',
                                              padding: '4px 10px',
                                              fontSize: '0.82rem'
                                            }}
                                          >
                                            {l.location_label}
                                            <button
                                              onClick={() => deleteLocation(l.id, l.floor_label, l.location_label)}
                                              style={{
                                                background: 'none',
                                                border: 'none',
                                                color: 'var(--red)',
                                                cursor: 'pointer',
                                                fontSize: '0.8rem',
                                                padding: 0
                                              }}
                                              title="Remove"
                                            >
                                              ✕
                                            </button>
                                          </span>
                                        ))}
                                    </div>
                                  </div>
                                ))
                              )}

                              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '10px' }}>
                                <form
                                  onSubmit={(e) => handleLocationSubmit(e, b.id)}
                                  style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: '8px' }}
                                >
                                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Add Single Location</div>

                                  {floorGroups.length > 0 && locationFloorMode === 'select' ? (
                                    <select
                                      value={locationForm.floor_label}
                                      onChange={(e) => {
                                        if (e.target.value === '__new__') {
                                          setLocationFloorMode('new')
                                          setLocationForm((prev) => ({ ...prev, floor_label: '' }))
                                        } else {
                                          setLocationForm((prev) => ({ ...prev, floor_label: e.target.value }))
                                        }
                                      }}
                                    >
                                      <option value="">-- Select Floor --</option>
                                      {floorGroups.map((f) => (
                                        <option key={f} value={f}>{f}</option>
                                      ))}
                                      <option value="__new__">+ Add New Floor...</option>
                                    </select>
                                  ) : (
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <input
                                        name="floor_label"
                                        placeholder="New floor name (e.g. 1st Floor)"
                                        value={locationForm.floor_label}
                                        onChange={handleLocationFormChange}
                                        style={{ flex: 1 }}
                                      />
                                      {floorGroups.length > 0 && (
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => {
                                            setLocationFloorMode('select')
                                            setLocationForm((prev) => ({ ...prev, floor_label: '' }))
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  <input
                                    name="location_label"
                                    placeholder="Location (e.g. Male CR - Left side)"
                                    value={locationForm.location_label}
                                    onChange={handleLocationFormChange}
                                  />
                                  {locationError && <p className="form-error">{locationError}</p>}
                                  <button className="btn btn-primary btn-sm" type="submit" disabled={locationSubmitting}>
                                    {locationSubmitting ? 'Adding...' : 'Add Location'}
                                  </button>
                                </form>

                                <form
                                  onSubmit={(e) => handleRoomSubmit(e, b.id)}
                                  style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: '8px' }}
                                >
                                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                                    Add Single Room (e.g. Room 106)
                                  </div>

                                  {floorGroups.length > 0 && roomFloorMode === 'select' ? (
                                    <select
                                      value={roomForm.floor_label}
                                      onChange={(e) => {
                                        if (e.target.value === '__new__') {
                                          setRoomFloorMode('new')
                                          setRoomForm((prev) => ({ ...prev, floor_label: '' }))
                                        } else {
                                          setRoomForm((prev) => ({ ...prev, floor_label: e.target.value }))
                                        }
                                      }}
                                    >
                                      <option value="">-- Select Floor --</option>
                                      {floorGroups.map((f) => (
                                        <option key={f} value={f}>{f}</option>
                                      ))}
                                      <option value="__new__">+ Add New Floor...</option>
                                    </select>
                                  ) : (
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <input
                                        name="floor_label"
                                        placeholder="New floor name (e.g. 1st Floor)"
                                        value={roomForm.floor_label}
                                        onChange={handleRoomFormChange}
                                        style={{ flex: 1 }}
                                      />
                                      {floorGroups.length > 0 && (
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => {
                                            setRoomFloorMode('select')
                                            setRoomForm((prev) => ({ ...prev, floor_label: '' }))
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  <input
                                    name="prefix"
                                    placeholder="Prefix (e.g. Room  or Rm)"
                                    value={roomForm.prefix}
                                    onChange={handleRoomFormChange}
                                  />
                                  <input
                                    name="number"
                                    placeholder="Room number (e.g. 106 or 303-304)"
                                    value={roomForm.number}
                                    onChange={handleRoomFormChange}
                                  />
                                  <input
                                    name="office"
                                    placeholder="Office in this room (optional)"
                                    value={roomForm.office}
                                    onChange={handleRoomFormChange}
                                  />
                                  {roomForm.number.trim() && (
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                      Will be added as:{' '}
                                      <strong>
                                        {roomForm.prefix}
                                        {roomForm.number.trim()}
                                        {roomForm.office.trim() ? ` - ${roomForm.office.trim()}` : ''}
                                      </strong>
                                    </div>
                                  )}
                                  {roomError && <p className="form-error">{roomError}</p>}
                                  <button className="btn btn-primary btn-sm" type="submit" disabled={roomSubmitting}>
                                    {roomSubmitting ? 'Adding...' : 'Add Room'}
                                  </button>
                                </form>

                                <form
                                  onSubmit={(e) => handleBulkSubmit(e, b.id)}
                                  style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '8px' }}
                                >
                                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                                    Bulk Add Rooms (e.g. Room 101–110)
                                  </div>

                                  {floorGroups.length > 0 && bulkFloorMode === 'select' ? (
                                    <select
                                      value={bulkForm.floor_label}
                                      onChange={(e) => {
                                        if (e.target.value === '__new__') {
                                          setBulkFloorMode('new')
                                          setBulkForm((prev) => ({ ...prev, floor_label: '' }))
                                        } else {
                                          setBulkForm((prev) => ({ ...prev, floor_label: e.target.value }))
                                        }
                                      }}
                                    >
                                      <option value="">-- Select Floor --</option>
                                      {floorGroups.map((f) => (
                                        <option key={f} value={f}>{f}</option>
                                      ))}
                                      <option value="__new__">+ Add New Floor...</option>
                                    </select>
                                  ) : (
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                      <input
                                        name="floor_label"
                                        placeholder="New floor name (e.g. 1st Floor)"
                                        value={bulkForm.floor_label}
                                        onChange={handleBulkFormChange}
                                        style={{ flex: 1 }}
                                      />
                                      {floorGroups.length > 0 && (
                                        <button
                                          type="button"
                                          className="btn btn-secondary btn-sm"
                                          onClick={() => {
                                            setBulkFloorMode('select')
                                            setBulkForm((prev) => ({ ...prev, floor_label: '' }))
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      )}
                                    </div>
                                  )}

                                  <input
                                    name="prefix"
                                    placeholder="Prefix (e.g. Room )"
                                    value={bulkForm.prefix}
                                    onChange={handleBulkFormChange}
                                  />
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                      name="start"
                                      type="number"
                                      placeholder="Start (101)"
                                      value={bulkForm.start}
                                      onChange={handleBulkFormChange}
                                    />
                                    <input
                                      name="end"
                                      type="number"
                                      placeholder="End (110)"
                                      value={bulkForm.end}
                                      onChange={handleBulkFormChange}
                                    />
                                  </div>
                                  {bulkError && <p className="form-error">{bulkError}</p>}
                                  <button className="btn btn-primary btn-sm" type="submit" disabled={bulkSubmitting}>
                                    {bulkSubmitting ? 'Generating...' : 'Generate Rooms'}
                                  </button>
                                </form>

                              </div>
                            </>
                          )
                        })()}
                      </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>
        )}

        {activeTab === 'equipment' && (
        <div>
        <div className="section-heading" id="equipment-inventory-section">
          <h2>Equipment Inventory</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() =>
                printReport(
                  buildInventoryReport(
                    filteredEquipment,
                    [
                      ['Type', filterType ? typeLabel(filterType) : 'All types'],
                      [
                        'Status',
                        filterStatus === '__needs_attention__'
                          ? 'Needs attention'
                          : filterStatus
                          ? STATUS_LABELS[filterStatus] || filterStatus
                          : 'All statuses'
                      ],
                      [
                        'Building',
                        filterBuilding
                          ? buildings.find((b) => b.id === filterBuilding)?.building_name || '—'
                          : 'All buildings'
                      ],
                      ...(searchTerm.trim() ? [['Search', `"${searchTerm.trim()}"`]] : [])
                    ],
                    reportCtx
                  )
                )
              }
              disabled={filteredEquipment.length === 0}
              title="Prints the equipment shown below, using the same filters."
            >
              🖨 Print Report ({filteredEquipment.length})
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setQrPrintItems(printableEquipment)}
              disabled={printableEquipment.length === 0}
              title="Retired (No Longer in Service) units are not printed — their QR code is never reused."
            >
              🖨 Print QR Labels ({printableEquipment.length})
            </button>
            <button className="btn btn-primary btn-sm" onClick={openAddForm}>
              {showAddForm ? 'Close' : '+ Add Equipment'}
            </button>
          </div>
        </div>


        {showAddForm && (
          <div className="panel">
            <form onSubmit={handleSubmit} className="form-grid">
              <div>
                <label className="field-label">Equipment Type</label>
                <select name="equipment_type" value={form.equipment_type} onChange={handleTypeChange}>
                  {allTypes.map((type) => (
                    <option key={type} value={type}>{typeLabel(type)}</option>
                  ))}
                  <option value={OTHER_TYPE}>Others (specify)...</option>
                </select>
              </div>

              {form.equipment_type === OTHER_TYPE && (
                <div>
                  <label className="field-label">New Equipment Type</label>
                  <input
                    placeholder="e.g. Fire Hose Reel"
                    value={otherTypeName}
                    onChange={handleOtherTypeNameChange}
                    autoFocus
                  />
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '6px 0 0 0' }}>
                    It will be added to the type list and to the Stock page automatically.
                  </p>
                </div>
              )}

              <div>
                <label className="field-label">Equipment Code (auto-generated)</label>
                <input name="equipment_code" value={form.equipment_code} disabled />
              </div>

              <div>
                <label className="field-label">Building</label>
                <select name="building_id" value={form.building_id} onChange={handleFormBuildingChange}>
                  <option value="">-- Select Building --</option>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>{b.building_name}</option>
                  ))}
                </select>
              </div>

              {form.building_id && selectedBuildingHasLocations && (
                <>
                  <div>
                    <label className="field-label">Floor</label>
                    <select value={formFloor} onChange={handleFormFloorChange}>
                      <option value="">-- Select Floor --</option>
                      {floorsForSelectedBuilding.map((floor) => (
                        <option key={floor} value={floor}>{floor}</option>
                      ))}
                    </select>
                  </div>

                  {formFloor && (
                    <div>
                      <label className="field-label">Room / Location</label>
                      <select value={formLocationChoice} onChange={handleFormLocationChoiceChange}>
                        <option value="">-- Select Location --</option>
                        {locationsForSelectedFloor.map((loc) => (
                          <option key={loc.id} value={loc.location_label}>{loc.location_label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {form.building_id && !selectedBuildingHasLocations && (
                <div
                  style={{
                    background: 'var(--amber-bg)',
                    border: '1px solid var(--amber-border)',
                    borderRadius: '8px',
                    padding: '14px'
                  }}
                >
                  <p style={{ margin: '0 0 10px 0', fontSize: '0.88rem', color: 'var(--amber)' }}>
                    This building has no floors/rooms set up yet. You must add at least one before
                    you can assign equipment to it — this keeps every location consistent and prevents typos.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => jumpToBuildingSetup(form.building_id)}
                  >
                    Set Up Floors/Rooms Now →
                  </button>
                </div>
              )}


              <div>
                <label className="field-label">QR Code Value (auto-generated)</label>
                <input name="qr_code" value={form.qr_code} disabled />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label className="field-label">Installation Date</label>
                  <input type="date" name="installation_date" value={form.installation_date} onChange={handleChange} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="field-label">Expiration Date</label>
                  <input type="date" name="expiration_date" value={form.expiration_date} onChange={handleChange} />
                </div>
              </div>

              <div>
                <label className="field-label">Status</label>
                <select name="current_status" value={form.current_status} onChange={handleChange}>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">Description</label>
                <textarea name="description" placeholder="Optional" value={form.description} onChange={handleChange} />
              </div>

              {form.equipment_type !== OTHER_TYPE && (() => {
                const inStore = stock.find((s) => s.equipment_type === form.equipment_type)?.quantity_available || 0
                return (
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={takeFromStock && inStore > 0}
                      disabled={inStore === 0}
                      onChange={(e) => setTakeFromStock(e.target.checked)}
                    />
                    <span>
                      {inStore > 0
                        ? `This unit is taken from the storeroom stock (${inStore} left — the system will make it ${inStore - 1}).`
                        : 'The storeroom has no stock of this type, so nothing is taken from Stock.'}
                      {inStore > 0 && form.equipment_type === 'fire_extinguisher' && (
                        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          Leave this unticked if it replaces a fire extinguisher whose job was closed as
                          Resolved — that unit was already taken from stock then.
                        </span>
                      )}
                    </span>
                  </label>
                )
              })()}

              {formError && <p className="form-error">{formError}</p>}

              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Saving...' : 'Add Equipment'}
              </button>
            </form>
          </div>
        )}

        <div className="panel" style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label className="field-label"> Equipment Type</label>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">All Types</option>
                {allTypes.map((type) => (
                  <option key={type} value={type}>{typeLabel(type)}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label className="field-label">Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All Statuses</option>
                {/* Set by the "Needs Attention" stat card: anything not
                    Functional and not retired. Listed so the dropdown shows
                    what the list is actually filtered by. */}
                <option value="__needs_attention__">Needs Attention</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label className="field-label">Building</label>
              <select value={filterBuilding} onChange={(e) => setFilterBuilding(e.target.value)}>
                <option value="">All Buildings</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>{b.building_name}</option>
                ))}
              </select>
            </div>
          </div>
          {(searchTerm || filterType || filterStatus || filterBuilding) && (
            <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Showing {filteredEquipment.length} of {equipment.length}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSearchTerm('')
                  setFilterType('')
                  setFilterStatus('')
                  setFilterBuilding('')
                }}
              >
                Clear Filters
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <p>Loading equipment...</p>
        ) : filteredEquipment.length === 0 ? (
          <p>No equipment matches your search/filters.</p>
        ) : (
          filteredEquipment.map((item) => (
            <div key={item.id} className="panel">
              {editingId === item.id ? (
                <div className="form-grid">
                  <div>
                    <label className="field-label">Equipment Code (locked)</label>
                    <input name="equipment_code" value={editForm.equipment_code} disabled />
                  </div>
                  <div>
                    <label className="field-label">Equipment Type</label>
                    <select name="equipment_type" value={editForm.equipment_type} onChange={handleEditChange}>
                      {allTypes.map((type) => (
                        <option key={type} value={type}>{typeLabel(type)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Building</label>
                    <select name="building_id" value={editForm.building_id} onChange={handleEditChange}>
                      <option value="">-- Select Building --</option>
                      {buildings.map((b) => (
                        <option key={b.id} value={b.id}>{b.building_name}</option>
                      ))}
                    </select>
                  </div>
                  {/* Dropdown-only, matching Add Equipment — free text here
                      would reintroduce exactly the typos the Add form's
                      strict rule exists to prevent. The current value stays
                      selectable so editing other fields never forces a
                      location change, and legacy values aren't lost. */}
                  <div>
                    <label className="field-label">Exact Location</label>
                    {(() => {
                      const locs = buildingLocations.filter(
                        (loc) => loc.building_id === editForm.building_id
                      )
                      const options = locs.map((loc) => `${loc.floor_label} - ${loc.location_label}`)
                      const currentIsListed = options.includes(editForm.exact_location)

                      if (locs.length === 0) {
                        return (
                          <p style={{ fontSize: '0.85rem', color: 'var(--amber)', margin: 0 }}>
                            This building has no floors/rooms set up. Current location:{' '}
                            <strong>{editForm.exact_location || '—'}</strong>
                          </p>
                        )
                      }

                      return (
                        <select
                          name="exact_location"
                          value={editForm.exact_location}
                          onChange={handleEditChange}
                        >
                          {!currentIsListed && editForm.exact_location && (
                            <option value={editForm.exact_location}>
                              {editForm.exact_location} (current)
                            </option>
                          )}
                          {!editForm.exact_location && <option value="">-- Select Location --</option>}
                          {options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      )
                    })()}
                  </div>
                  <div>
                    <label className="field-label">QR Code Value (locked)</label>
                    <input name="qr_code" value={editForm.qr_code} disabled />
                  </div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <label className="field-label">Installation Date</label>
                      <input type="date" name="installation_date" value={editForm.installation_date || ''} onChange={handleEditChange} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="field-label">Expiration Date</label>
                      <input type="date" name="expiration_date" value={editForm.expiration_date || ''} onChange={handleEditChange} />
                    </div>
                  </div>
                  <div>
                    <label className="field-label">Status</label>
                    <select name="current_status" value={editForm.current_status} onChange={handleEditChange}>
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Description</label>
                    <textarea name="description" value={editForm.description} onChange={handleEditChange} />
                  </div>

                  {editError && <p className="form-error">{editError}</p>}

                  <div className="equipment-actions">
                    <button className="btn btn-primary" onClick={() => saveEdit(item.id)} disabled={editSaving}>
                      {editSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button className="btn btn-secondary" onClick={cancelEdit} disabled={editSaving}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                (() => {
                  const history = inspectionsByEquipment[item.id] || []
                  // Decision support: only for a unit that is Functional now
                  // and whose last fixed defect was low or medium priority.
                  const pastDefect =
                    item.current_status === 'functional' ? lastResolvedByEquipment[item.id] : null
                  const showRecommendation =
                    pastDefect && LOW_RISK_PRIORITIES.includes(pastDefect.priority)

                  return (
                    <div>
                      <div className="equipment-card-head">
                        <div>
                          <div className="equipment-title">
                            {item.equipment_code} — {TYPE_LABELS[item.equipment_type] || item.equipment_type}
                          </div>
                          <div className="equipment-meta">
                            {item.buildings?.building_name ?? 'Not assigned'} · {item.exact_location}
                          </div>
                          <div className="equipment-meta">
                            Expires: {item.expiration_date ? formatTimestamp(item.expiration_date) : '—'}
                          </div>
                        </div>
                        <span className={`status-badge ${item.current_status === 'functional' ? 'active' : 'inactive-state'}`}>
                          {item.current_status === 'functional' ? '✓ Functional' : `⚠ ${STATUS_LABELS[item.current_status] || item.current_status}`}
                        </span>
                      </div>

                      {showRecommendation && (
                        <p style={{ fontSize: '0.85rem', color: 'var(--amber)', margin: '8px 0 0 0' }}>
                          Previously reported defective: "{pastDefect.description}" (
                          <span style={{ textTransform: 'capitalize' }}>{pastDefect.priority}</span> priority,
                          fixed {relativeTime(pastDefect.completed_date)}). Recommendation:{' '}
                          {RECOMMENDATION_BY_ACTION[pastDefect.action_type] || RECOMMENDATION_BY_ACTION.other}
                        </p>
                      )}

                      <div className="equipment-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(item)}>Edit</button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setExpandedQrId(expandedQrId === item.id ? null : item.id)}
                        >
                          {expandedQrId === item.id ? 'Hide QR' : 'QR Code'}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setExpandedHistoryId(expandedHistoryId === item.id ? null : item.id)}
                        >
                          {expandedHistoryId === item.id
                            ? 'Hide History'
                            : `Inspection History (${history.length})`}
                        </button>
                      </div>

                      {expandedQrId === item.id && (
                        <div style={{ marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                          <QrLabel item={item} />
                          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '10px 0' }}>
                            Encodes <strong>{item.qr_code}</strong> only. Scanning looks the record up
                            live, so this sticker stays accurate if the unit is moved or refilled.
                          </p>
                          {item.current_status === 'no_longer_in_service' ? (
                            <p style={{ fontSize: '0.85rem', color: 'var(--red)', margin: 0 }}>
                              This unit is retired, so its label can't be printed — its QR code is a
                              unique identifier and is never reused.
                            </p>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => setQrPrintItems([item])}
                            >
                              🖨 Print This Label
                            </button>
                          )}
                        </div>
                      )}

                      {expandedHistoryId === item.id && (
                        <div style={{ marginTop: '14px', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
                          {history.length === 0 ? (
                            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0 }}>
                              No inspections recorded yet. Inspections are submitted from the mobile app.
                            </p>
                          ) : (
                            history.map((insp) => {
                              const failed = insp.condition_status === 'defective'
                              return (
                                <div
                                  key={insp.id}
                                  style={{
                                    borderLeft: `3px solid ${failed ? 'var(--red)' : 'var(--green)'}`,
                                    paddingLeft: '12px',
                                    marginBottom: '14px'
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '9px',
                                      flexWrap: 'wrap'
                                    }}
                                  >
                                    <span className={`status-badge ${failed ? 'inactive-state' : 'active'}`}>
                                      {failed ? '⚠ Defective' : '✓ Functional'}
                                    </span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                      {formatTimestamp(insp.inspection_date)}
                                      <span style={{ opacity: 0.75 }}>
                                        {' · '}{relativeTime(insp.inspection_date)}
                                      </span>
                                    </span>
                                  </div>

                                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '5px 0 0 0' }}>
                                    Inspected by: <strong>{insp.inspector_name || 'Not recorded'}</strong>
                                  </p>

                                  {insp.findings && (
                                    <p style={{ fontSize: '0.9rem', margin: '6px 0 0 0' }}>
                                      <strong>Findings:</strong> {insp.findings}
                                    </p>
                                  )}
                                  {insp.recommended_action && (
                                    <p style={{ fontSize: '0.9rem', margin: '3px 0 0 0' }}>
                                      <strong>Recommended:</strong> {insp.recommended_action}
                                    </p>
                                  )}
                                  {insp.inspection_notes && (
                                    <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '3px 0 0 0' }}>
                                      {insp.inspection_notes}
                                    </p>
                                  )}
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()
              )}
            </div>
          ))
        )}
        </div>
        )}

        {/* ===================== REPORTS TAB ===================== */}
        {activeTab === 'reports' && (
          <ReportsTab
            key={reportStart.n}
            initialReport={reportStart.key}
            equipment={equipment}
            buildings={buildings}
            inspections={inspections}
            actions={allActions}
            technicians={technicians}
            purchaseItems={purchaseRequestItems}
            types={allTypes}
            statusOptions={STATUS_OPTIONS}
            ctx={reportCtx}
            summaryRows={summaryRows}
            onPrint={printReport}
            onOpenSummary={() => setShowSummary(true)}
          />
        )}

        {/* ===================== INSPECTORS TAB ===================== */}
        {activeTab === 'inspectors' && (
          <InspectorsTab
            inspections={inspections}
            equipment={equipment}
            buildings={buildings}
            buildingLocations={buildingLocations}
            actions={allActions}
            purchaseItems={purchaseRequestItems}
            onOpenPurchaseSummary={openPurchaseSummary}
            leaves={upcomingLeaves}
            availabilityKey={availabilityChanges[0]?.id || ''}
            adminName={profile.full_name}
            adminRole={profile.role}
          />
        )}

        {/* ===================== STOCK TAB ===================== */}
        {activeTab === 'stock' && (
          <div>
            <div className="section-heading">
              <h2>Stock</h2>
              <span className="count-pill neutral">Units in the GSO storeroom</span>
            </div>

            <p className="page-hint">
              <b>In storeroom:</b> new units kept by the GSO, entered here when they arrive. The
              system takes 1 away by itself when a unit is installed from the storeroom (Add
              Equipment) or used to replace a fire extinguisher. <b>Installed units:</b> counted
              by the system from inspections and repairs — a unit found defective moves from
              Functional to Needs attention, a fixed one moves back.
            </p>

            {stockMessage && (
              <div className="all-clear-banner" style={{ marginBottom: '14px' }}>
                ✓ {stockMessage}
              </div>
            )}

            <div className="card-grid">
              {allTypes.map((type) => {
                const s = stock.find((item) => item.equipment_type === type)
                const currentQty = s ? s.quantity_available : 0
                const isFE = type === 'fire_extinguisher'
                const isCustom = !EQUIPMENT_TYPES.includes(type)
                const u = installedStats(type)

                return (
                  <div key={type} className="info-card">
                    <div className="info-card-top">
                      <strong>{typeLabel(type)}</strong>
                      <span className={`tag ${currentQty === 0 ? 'tag-red' : 'tag-green'}`}>
                        {currentQty === 0 ? 'Out of stock' : 'On hand'}
                      </span>
                    </div>

                    <div className="stock-label">In storeroom (new, not installed)</div>
                    <div className="stock-qty-row">
                      <div className="stock-qty">{currentQty}</div>
                      <input
                        type="number"
                        min="0"
                        aria-label={`New quantity for ${typeLabel(type)}`}
                        value={stockEdits[type] !== undefined ? stockEdits[type] : currentQty}
                        onChange={(e) => {
                          const val = e.target.value
                          setStockEdits((prev) => ({ ...prev, [type]: val }))
                        }}
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSaveStock(type)}
                        disabled={stockSaving}
                      >
                        Save
                      </button>
                    </div>

                    <div className="info-line">
                      {s?.updated_at
                        ? `Updated ${formatTimestamp(s.updated_at)}${s.updated_by ? ` by ${s.updated_by}` : ''}`
                        : isCustom
                        ? 'Added automatically from "Others"'
                        : 'No updates recorded yet'}
                    </div>
                    {isFE && (
                      <div className="info-line">1 unit is deducted automatically when a fire extinguisher job is closed as Resolved.</div>
                    )}

                    {/* Counted by the system from the equipment records — not typed in. */}
                    <div className="installed-box">
                      <div className="stock-label">Installed units (counted by the system)</div>
                      <div className="installed-total">
                        <b>{u.total}</b> in service
                        {u.retired > 0 && <span> · {u.retired} no longer in service</span>}
                      </div>
                      <div className="type-bar" title={`${u.ok} functional, ${u.bad} need attention`}>
                        {u.ok > 0 && <i style={{ width: `${(u.ok / Math.max(1, u.total)) * 100}%`, background: 'var(--green)' }} />}
                        {u.bad > 0 && <i style={{ width: `${(u.bad / Math.max(1, u.total)) * 100}%`, background: 'var(--red)' }} />}
                      </div>
                      <div className="type-counts">
                        <span className="ok">{u.ok} functional ({u.total ? Math.round((u.ok / u.total) * 100) : 0}%)</span>
                        <span className="bad">{u.bad} needs attention ({u.total ? Math.round((u.bad / u.total) * 100) : 0}%)</span>
                      </div>
                      <div className="info-line" style={{ marginTop: '4px' }}>
                        Inspected this month: <b>{u.inspected} of {u.total}</b>
                        {u.inspected > 0 && ` · ${u.inspectedOk} functional · ${u.inspectedBad} defective`}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ===================== TECHNICIANS TAB ===================== */}
        {activeTab === 'technicians' && (
          <div>
            <div className="section-heading">
              <h2>Technicians</h2>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className="count-pill neutral">{technicians.length} listed</span>
                <button className="btn btn-primary btn-sm" onClick={() => setShowTechnicianForm((v) => !v)}>
                  {showTechnicianForm ? 'Close' : '+ Add Technician'}
                </button>
              </div>
            </div>

            {showTechnicianForm && (
              <div className="panel">
                <form onSubmit={handleTechnicianSubmit} className="form-grid">
                  <div>
                    <label className="field-label">Full Name</label>
                    <input
                      placeholder="e.g. Juan Dela Cruz"
                      value={technicianForm.full_name}
                      onChange={(e) => setTechnicianForm((prev) => ({ ...prev, full_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="field-label">Contact Information</label>
                    <input
                      placeholder="e.g. 0917-123-4567 / Ext. 102"
                      value={technicianForm.contact_info}
                      onChange={(e) => setTechnicianForm((prev) => ({ ...prev, contact_info: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="field-label">Username (for the mobile app)</label>
                    <input
                      placeholder="e.g. kenntech"
                      autoComplete="off"
                      value={technicianForm.username}
                      onChange={(e) => setTechnicianForm((prev) => ({ ...prev, username: e.target.value }))}
                    />
                    <p style={HINT_STYLE}>{USERNAME_HINT}</p>
                  </div>
                  <div>
                    <label className="field-label">Password (at least 6 characters)</label>
                    <PasswordInput
                      value={technicianForm.password}
                      onChange={(e) => setTechnicianForm((prev) => ({ ...prev, password: e.target.value }))}
                    />
                  </div>

                  {technicianError && <p className="form-error">{technicianError}</p>}

                  <button type="submit" className="btn btn-primary" disabled={technicianSubmitting}>
                    {technicianSubmitting ? 'Creating account...' : 'Add Technician'}
                  </button>
                </form>
              </div>
            )}

            {accountNotice && (
              <div className="all-clear-banner" style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span>✓ {accountNotice}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setAccountNotice(null)}>OK</button>
              </div>
            )}

            {technicians.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>No technicians registered yet.</p>
            ) : (
              <div className="card-grid">
                {technicians.map((t) => {
                  const acc = t.profile_id && staffAccounts.find((a) => a.id === t.profile_id)
                  const counts = technicianCounts(t.id)
                  return (
                  <div key={t.id} className="info-card">
                    {editingTechnicianId === t.id ? (
                      <div className="form-grid">
                        <div>
                          <label className="field-label">Full Name</label>
                          <input
                            value={editTechnicianForm.full_name}
                            onChange={(e) => setEditTechnicianForm((prev) => ({ ...prev, full_name: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="field-label">Contact Info</label>
                          <input
                            value={editTechnicianForm.contact_info}
                            onChange={(e) => setEditTechnicianForm((prev) => ({ ...prev, contact_info: e.target.value }))}
                          />
                        </div>
                        {/* With an app account, the technician sets this in the app. */}
                        {!editTechnicianForm.has_account && (
                          <div>
                            <label className="field-label">Availability</label>
                            <select
                              value={editTechnicianForm.is_available ? 'yes' : 'no'}
                              onChange={(e) => setEditTechnicianForm((prev) => ({ ...prev, is_available: e.target.value === 'yes' }))}
                            >
                              <option value="yes">Available</option>
                              <option value="no">Unavailable</option>
                            </select>
                            <p style={HINT_STYLE}>
                              No app account yet. Once they have one, they set this themselves in the app.
                            </p>
                          </div>
                        )}
                        {editTechnicianError && <p className="form-error">{editTechnicianError}</p>}
                        <div className="equipment-actions">
                          <button className="btn btn-primary btn-sm" onClick={() => saveEditTechnician(t.id)} disabled={editTechnicianSaving}>
                            Save
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={cancelEditTechnician}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="info-card-top">
                          <strong>{t.full_name}</strong>
                          <span className="tag-row">
                            <span
                              className={`tag ${t.is_available ? 'tag-green' : 'tag-grey'}`}
                              title={t.profile_id ? 'Set by the technician in the mobile app' : 'No app account yet'}
                            >
                              {t.is_available ? 'Available' : 'Unavailable'}
                            </span>
                            {t.profile_id && (
                              <CalendarButton onClick={() => setCalendarFor({ id: t.profile_id, name: t.full_name })} />
                            )}
                          </span>
                        </div>
                        <div className="info-line">
                          Username <b>{acc ? acc.username : 'No app account yet'}</b>
                        </div>
                        <div className="info-line">
                          Contact <b>{t.contact_info || 'Not provided'}</b>
                        </div>
                        <LeaveLine leaves={leavesFor(t.profile_id)} />

                        <div className="mini-stats">
                          <span title="Open jobs not yet marked repaired">
                            <b>{counts.assigned}</b>Assigned
                          </span>
                          <span title="Jobs they are working on now">
                            <b>{counts.working}</b>Working
                          </span>
                          <span title="Jobs closed by GSO">
                            <b className={counts.completed > 0 ? 'ok' : ''}>{counts.completed}</b>Completed
                          </span>
                        </div>

                        {/* Assign job order: the defects still waiting for a
                            technician, most urgent first. Picking one opens
                            the Job Order Request form with this technician. */}
                        {jobPickFor === t.id && (
                          <div className="assign-box">
                            <div className="assign-head">
                              Choose a defect to assign
                              <span className="assign-count">{jobOrderActions.length}</span>
                            </div>
                            {jobOrderActions.length === 0 ? (
                              <div className="info-line">✓ No defects are waiting for a job order.</div>
                            ) : (
                              jobOrderActions.map((a) => {
                                // Needs a new unit and there's none in stock:
                                // the Purchase Request comes first.
                                const waitsForPurchase = purchaseRequestItems.some((p) => p.actionId === a.id)
                                return (
                                <button
                                  key={a.id}
                                  className="pick-row"
                                  disabled={waitsForPurchase}
                                  title={waitsForPurchase ? 'No unit in stock yet — file a Purchase Request first.' : 'Assign this job to the technician'}
                                  onClick={() => {
                                    setJobPickFor(null)
                                    openJobOrderRequest(a, t.id)
                                  }}
                                >
                                  <span className="assign-row-top">
                                    <b>
                                      {a.equipment?.equipment_code} — {typeLabel(a.equipment?.equipment_type)}
                                    </b>
                                    <span className={`tag ${a.priority === 'critical' ? 'tag-red' : a.priority === 'high' ? 'tag-orange' : a.priority === 'medium' ? 'tag-amber' : 'tag-blue'}`}>
                                      {a.priority}
                                    </span>
                                  </span>
                                  <span className="info-line">
                                    {a.equipment?.buildings?.building_name ?? 'N/A'} — {a.equipment?.exact_location}
                                  </span>
                                  <span className="info-line">
                                    {a.description} · reported {formatTimestamp(a.reported_date)}
                                  </span>
                                  {waitsForPurchase && (
                                    <span className="info-line" style={{ color: 'var(--red)', fontWeight: 600 }}>
                                      Needs a Purchase Request first — no unit in stock to install.
                                    </span>
                                  )}
                                </button>
                                )
                              })
                            )}
                          </div>
                        )}

                        <div className="info-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setTechHistoryFor(t.id)
                              setTechHistFilter({ from: '', to: '', priority: '' })
                              setTechHistPage(0)
                            }}
                          >
                            History ({allActions.filter((a) => a.assigned_technician_id === t.id).length})
                          </button>
                          <button
                            className={`btn btn-sm ${jobPickFor === t.id ? 'btn-secondary' : 'btn-primary'}`}
                            onClick={() => setJobPickFor(jobPickFor === t.id ? null : t.id)}
                            title="Give this technician a reported defect to repair"
                          >
                            {jobPickFor === t.id ? 'Close list' : `Assign job order (${jobOrderActions.length})`}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => startEditTechnician(t)}>
                            Edit
                          </button>
                          {acc && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() =>
                                setAccountSettingsFor({ id: acc.id, full_name: t.full_name, username: acc.username })
                              }
                            >
                              Account settings
                            </button>
                          )}
                          {!t.profile_id && techLoginFor !== t.id && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                setTechLoginFor(t.id)
                                setTechLoginForm({ username: '', password: '' })
                                setTechLoginError(null)
                              }}
                            >
                              Create app account
                            </button>
                          )}
                          <button className="btn btn-outline-red btn-sm" onClick={() => deleteTechnician(t.id, t.full_name)}>
                            Delete
                          </button>
                        </div>

                        {/* A technician added before accounts existed has no
                            mobile login yet — give them one here. */}
                        {!t.profile_id && techLoginFor === t.id && (
                          <div className="form-grid" style={{ marginTop: '12px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                            <div>
                              <label className="field-label">Username (for the mobile app)</label>
                              <input
                                placeholder="e.g. kenntech"
                                autoComplete="off"
                                value={techLoginForm.username}
                                onChange={(e) => setTechLoginForm((prev) => ({ ...prev, username: e.target.value }))}
                              />
                              <p style={HINT_STYLE}>{USERNAME_HINT}</p>
                            </div>
                            <div>
                              <label className="field-label">Password (at least 6 characters)</label>
                              <PasswordInput
                                value={techLoginForm.password}
                                onChange={(e) => setTechLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                              />
                            </div>
                            {techLoginError && <p className="form-error">{techLoginError}</p>}
                            <div className="equipment-actions" style={{ marginTop: 0 }}>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleCreateTechnicianLogin(t)}
                                disabled={techLoginSaving}
                              >
                                {techLoginSaving ? 'Creating...' : 'Create account'}
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setTechLoginFor(null)}
                                disabled={techLoginSaving}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
          </div>
        </main>
      </div>

      {/* ===================== OUTCOME MODAL (Feature 1) ===================== */}
      {outcomeModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '460px' }}>
            <div className="modal-title">Record Work Outcome</div>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
              Equipment: <strong>{outcomeModal.equipment?.equipment_code}</strong> ({TYPE_LABELS[outcomeModal.equipment?.equipment_type] || outcomeModal.equipment?.equipment_type})
            </p>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
              <label
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: `2px solid ${outcomeChoice === 'resolved' ? 'var(--blue)' : 'var(--border)'}`,
                  background: outcomeChoice === 'resolved' ? 'var(--blue-light)' : '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem'
                }}
              >
                <input
                  type="radio"
                  name="outcomeChoice"
                  value="resolved"
                  checked={outcomeChoice === 'resolved'}
                  onChange={() => setOutcomeChoice('resolved')}
                  style={{ width: 'auto', margin: 0 }}
                />
                Resolved (Success)
              </label>

              <label
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: `2px solid ${outcomeChoice === 'unresolved' ? 'var(--red)' : 'var(--border)'}`,
                  background: outcomeChoice === 'unresolved' ? 'var(--red-bg)' : '#fff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem'
                }}
              >
                <input
                  type="radio"
                  name="outcomeChoice"
                  value="unresolved"
                  checked={outcomeChoice === 'unresolved'}
                  onChange={() => setOutcomeChoice('unresolved')}
                  style={{ width: 'auto', margin: 0 }}
                />
                Unresolved (Failed)
              </label>
            </div>

            {outcomeChoice === 'resolved' ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '14px', background: 'var(--gray-bg)', padding: '10px 12px', borderRadius: '8px' }}>
                {outcomeModal.equipment?.equipment_type === 'fire_extinguisher' ? (
                  <>✓ <strong>{outcomeModal.equipment?.equipment_code}</strong> will be retired as <em>No Longer in Service</em>. 1 unit will be deducted from stock, and you will be asked to add the replacement unit.</>
                ) : (
                  <>✓ Work succeeded. <strong>{outcomeModal.equipment?.equipment_code}</strong> will revert to <strong>Functional</strong>.</>
                )}
              </div>
            ) : (
              <div style={{ fontSize: '0.85rem', color: 'var(--red)', marginBottom: '14px', background: 'var(--red-bg)', border: '1px solid var(--red-border)', padding: '10px 12px', borderRadius: '8px' }}>
                ⚠ Work failed or could not be completed. The equipment will <strong>NOT</strong> be marked functional. This action will stay visible in Priority Actions with an <em>Unresolved</em> badge so GSO can reassess.
              </div>
            )}

            <div>
              <label className="field-label">
                {outcomeChoice === 'unresolved' ? 'Reason for Failure / Notes (Required)' : 'Completion Notes (Optional)'}
              </label>
              <textarea
                placeholder={outcomeChoice === 'unresolved' ? 'e.g. Technician could not fix panel; board burned, requires full replacement.' : 'e.g. Repaired and tested working.'}
                value={outcomeReason}
                onChange={(e) => setOutcomeReason(e.target.value)}
                style={{ minHeight: '75px' }}
              />
            </div>

            <div className="modal-actions" style={{ gap: '8px', marginTop: '16px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setOutcomeModal(null)
                  setOutcomeReason('')
                }}
                disabled={actionUpdatingId === outcomeModal.id}
              >
                Cancel
              </button>
              <button
                className={`btn ${outcomeChoice === 'resolved' ? 'btn-primary' : 'btn-outline-red'}`}
                onClick={() => {
                  if (outcomeChoice === 'unresolved' && !outcomeReason.trim()) {
                    alert('Please enter a reason why the work could not be completed.')
                    return
                  }

                  if (outcomeChoice === 'resolved') {
                    const code = outcomeModal.equipment?.equipment_code
                    const isFE = outcomeModal.equipment?.equipment_type === 'fire_extinguisher'
                    const message = isFE
                      ? `Confirm ${code} is resolved?\n\nThis is permanent. ${code} will be retired as No Longer in Service, 1 unit will be deducted from stock, and you will be asked to add its replacement.\n\nThis cannot be undone from the dashboard.`
                      : `Confirm ${code} is resolved?\n\nThe work succeeded and ${code} will return to Functional.`
                    if (!window.confirm(message)) return
                  }

                  handleRecordOutcome(outcomeModal, outcomeChoice, outcomeReason)
                }}
                disabled={actionUpdatingId === outcomeModal.id}
              >
                {outcomeChoice === 'resolved' ? 'Confirm Resolved' : 'Mark Unresolved'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== JOB ORDER REQUEST FORM ===================== */}
      {techAssignModal && (
        <JobOrderRequestModal
          modal={techAssignModal}
          profile={profile}
          technicians={technicians}
          fireExtinguisherStock={
            stock.find((x) => x.equipment_type === 'fire_extinguisher')?.quantity_available ?? 0
          }
          selectedTechnicianId={selectedTechnicianId}
          onSelectTechnician={setSelectedTechnicianId}
          remarks={jobOrderRemarks}
          onRemarksChange={setJobOrderRemarks}
          leaves={upcomingLeaves}
          onCancel={() => setTechAssignModal(null)}
          onSubmit={handleConfirmStartWork}
        />
      )}

      {/* The sheet the print dialog prints. Off-screen normally; the print
          stylesheet hides the dashboard and shows only this. */}
      {qrPrintItems.length > 0 && (
        <div className="qr-print-area">
          <h2 className="qr-print-title">NBSC Fire Safety Equipment — QR Labels</h2>
          <div className="qr-print-grid">
            {qrPrintItems.map((item) => (
              <QrLabel key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {/* Repair history: its own window with a compact table, like the
          inspectors' Inspection history, so the card stays short. */}
      {techHistoryFor && (() => {
        const tech = technicians.find((x) => x.id === techHistoryFor)
        if (!tech) return null
        const jobs = allActions
          .filter((a) => a.assigned_technician_id === tech.id)
          .sort((a, b) => new Date(b.reported_date) - new Date(a.reported_date))
        // Filter by the day it was reported (Philippine calendar day) and priority.
        const f = techHistFilter
        const shown = jobs.filter((a) => {
          const day = a.reported_date ? manilaDay(a.reported_date) : ''
          if (f.from && day < f.from) return false
          if (f.to && day > f.to) return false
          if (f.priority && a.priority !== f.priority) return false
          return true
        })
        const backwards = f.from && f.to && f.from > f.to
        const pageSize = 10
        const pages = Math.max(1, Math.ceil(shown.length / pageSize))
        const page = Math.min(techHistPage, pages - 1)
        const pageItems = shown.slice(page * pageSize, (page + 1) * pageSize)
        const setFilter = (next) => {
          setTechHistFilter(next)
          setTechHistPage(0)
        }
        return (
          <div className="modal-overlay" onClick={() => setTechHistoryFor(null)}>
            <div className="modal-box history-box" onClick={(e) => e.stopPropagation()}>
              <div className="history-head">
                <div>
                  <div className="modal-title" style={{ marginBottom: '2px' }}>Repair history</div>
                  <div className="info-line">
                    {tech.full_name} · {jobs.length} job{jobs.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setTechHistoryFor(null)}>Close</button>
              </div>

              <div className="hist-filters">
                <label>
                  Reported from
                  <input type="date" value={f.from} onChange={(e) => setFilter({ ...f, from: e.target.value })} />
                </label>
                <label>
                  To
                  <input type="date" value={f.to} onChange={(e) => setFilter({ ...f, to: e.target.value })} />
                </label>
                <label>
                  Priority
                  <select value={f.priority} onChange={(e) => setFilter({ ...f, priority: e.target.value })}>
                    <option value="">All</option>
                    {['critical', 'high', 'medium', 'low'].map((p) => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </label>
              </div>
              {(f.from || f.to || f.priority) && (
                <div className="info-line" style={{ marginBottom: '8px' }}>
                  {backwards ? 'The "From" date is after the "To" date.' : `Showing ${shown.length} of ${jobs.length}.`}{' '}
                  <button className="link-btn" onClick={() => setFilter({ from: '', to: '', priority: '' })}>
                    Clear filters
                  </button>
                </div>
              )}

              {backwards ? null : jobs.length === 0 ? (
                <div className="info-line">No jobs given to this technician yet.</div>
              ) : shown.length === 0 ? (
                <div className="info-line">No jobs match these filters.</div>
              ) : (
                <div className="history-table-wrap">
                  <table className="data-table history-table">
                    <thead>
                      <tr>
                        <th>Reported</th>
                        <th>Code</th>
                        <th>Problem</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((a) => {
                        const done = a.status === 'completed'
                        let status = ACTION_STATUS_LABELS[a.status] || a.status
                        if (a.status === 'in_progress' && a.repair_status === 'working') status += ' (working)'
                        if (a.status === 'in_progress' && a.repair_status === 'repaired') status += ' (marked repaired)'
                        return (
                          <tr key={a.id}>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatTimestamp(a.reported_date)}</td>
                            <td>
                              <b>{a.equipment?.equipment_code || '—'}</b>
                              <div className="info-line">{typeLabel(a.equipment?.equipment_type)}</div>
                            </td>
                            <td>
                              {a.description || '—'}
                              <ReplacementNote
                                action={a}
                                purchaseItems={purchaseRequestItems}
                                onOpenPurchaseSummary={() => {
                                  setTechHistoryFor(null)
                                  openPurchaseSummary()
                                }}
                              />
                            </td>
                            <td>
                              <span className={`tag ${a.priority === 'critical' ? 'tag-red' : a.priority === 'high' ? 'tag-orange' : a.priority === 'medium' ? 'tag-amber' : 'tag-blue'}`}>
                                {a.priority}
                              </span>
                            </td>
                            <td>
                              <span className={`tag ${done ? 'tag-green' : 'tag-amber'}`}>{status}</span>
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>{done && a.completed_date ? formatTimestamp(a.completed_date) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!backwards && pages > 1 && (
                <div className="history-pager">
                  <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setTechHistPage(page - 1)}>
                    ‹ Newer
                  </button>
                  <span className="info-line">
                    Page {page + 1} of {pages} · {page * pageSize + 1}–{Math.min(shown.length, (page + 1) * pageSize)} of {shown.length}
                  </span>
                  <button className="btn btn-secondary btn-sm" disabled={page >= pages - 1} onClick={() => setTechHistPage(page + 1)}>
                    Older ›
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {calendarFor && (
        <AvailabilityModal
          profileId={calendarFor.id}
          name={calendarFor.name}
          onClose={() => setCalendarFor(null)}
        />
      )}

      {accountSettingsFor && (
        <AccountSettingsModal
          account={accountSettingsFor}
          onClose={() => setAccountSettingsFor(null)}
          onSaved={(message) => {
            setAccountSettingsFor(null)
            setAccountNotice(message)
            getStaffAccounts()
          }}
        />
      )}

      {/* Report sheet — the table the Reports page (or the Equipment page's
          Print Report) built, exactly as previewed. */}
      {reportPrint && (
        <div className="report-print-area">
          <div className="report-print-head">
            <img className="print-letterhead" src={nbscHeader} alt="Northern Bukidnon State College" />
            <div className="report-print-school">General Services Office</div>
            <h2 className="report-print-title">{reportPrint.title}</h2>

            <div className="report-print-meta">
              Filters —{' '}
              {reportPrint.filterText.map(([label, value], i) => (
                <span key={label}>
                  {i > 0 && ' · '}
                  {label}: <strong>{value}</strong>
                </span>
              ))}
            </div>
            <div className="report-print-meta">
              Total: <strong>{reportPrint.total}</strong> {reportPrint.unit}
              {reportPrint.total === 1 ? '' : 's'}
            </div>
          </div>
          <table className="report-print-table">
            <thead>
              <tr>
                {reportPrint.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reportPrint.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="report-print-signature">
            <div className="report-print-sig-label">Prepared by:</div>
            <div className="report-print-sig-name">{profile.full_name}</div>
            <div className="report-print-sig-role">
              {profile.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : ''} · General Services Office
            </div>
          </div>
          {/* The print date: bottom left of every printed page */}
          <div className="print-footer-date">Date printed: {formatTimestamp(reportPrint.generatedAt.toISOString())}</div>
        </div>
      )}

      {replacementPrompt && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-title">Add replacement equipment?</div>
            <p className="modal-message">
              {replacementPrompt.oldCode} has been retired. Fire extinguishers typically
              expire 2 years from installation — add its replacement now, pre-filled with
              the same location and a 2-year expiration? You can still adjust the details
              afterward.
            </p>
            {replacementPrompt.stockEmpty && (
              <div style={{ fontSize: '0.85rem', color: 'var(--red)', margin: '0 0 14px 0', background: 'var(--red-bg)', border: '1px solid var(--red-border)', padding: '10px 12px', borderRadius: '8px' }}>
                ⚠ The storeroom has no fire extinguishers, so no unit was deducted from stock. Add stock on the Stock page first.
              </div>
            )}
            <div className="modal-actions" style={{ gap: '8px' }}>
              <button className="btn btn-secondary" onClick={() => setReplacementPrompt(null)}>
                Not now
              </button>
              <button className="btn btn-primary" onClick={handleAddReplacement}>
                + Add Replacement
              </button>
            </div>
          </div>
        </div>
      )}

      {showSummary && (
        <SummaryModal
          equipment={equipment}
          actions={sortedActions}
          inspections={inspections}
          technicians={technicians}
          stock={stock}
          expiring={expiringEquipment}
          completed={completedActions}
          purchaseItems={purchaseRequestItems}
          types={allTypes}
          preparedBy={profile}
          onClose={() => setShowSummary(false)}
        />
      )}

      {showBackToTop && (
        <button
          className="back-to-top-btn"
          onClick={scrollToTop}
          title="Back to Top"
          aria-label="Back to Top"
        >
          <span className="back-to-top-arrow">↑</span>
          <span className="back-to-top-text">Back to Top</span>
        </button>
      )}
    </div>
  )
}

export default App
